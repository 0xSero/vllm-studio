import ctypes
import json
import os
import re
import signal
import sys
import threading
import time
import traceback
from importlib.metadata import version
from pathlib import Path


os.umask(0o077)

BACKEND = "chatterbox-turbo"
PACKAGE_VERSION = "0.1.7"
MODEL_REPOSITORY = "ResembleAI/chatterbox-turbo"
MODEL_REVISION = "749d1c1a46eb10492095d68fbcf55691ccf137cd"
MODEL_PATTERNS = ["*.safetensors", "*.json", "*.txt", "*.pt", "*.model"]
MAX_LINE_BYTES = 64 * 1024
MAX_TEXT_CHARACTERS = 4096
GPU_UUID_PATTERN = re.compile(r"^GPU-[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$")
PROTOCOL_OUTPUT = sys.stdout
sys.stdout = sys.stderr
PROCESS_KILL_SIGNAL = getattr(signal, "SIGKILL", signal.SIGTERM)


def bind_parent_lifetime():
    parent_pid = os.getppid()
    if parent_pid == 1:
        os.kill(os.getpid(), PROCESS_KILL_SIGNAL)
    if sys.platform.startswith("linux"):
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl.argtypes = [
            ctypes.c_int,
            ctypes.c_ulong,
            ctypes.c_ulong,
            ctypes.c_ulong,
            ctypes.c_ulong,
        ]
        libc.prctl.restype = ctypes.c_int
        if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), "Could not bind speech worker to controller lifetime")
        if os.getppid() != parent_pid:
            os.kill(os.getpid(), PROCESS_KILL_SIGNAL)
        return

    def watch_parent():
        while os.getppid() == parent_pid:
            time.sleep(0.5)
        os.kill(os.getpid(), PROCESS_KILL_SIGNAL)

    threading.Thread(target=watch_parent, daemon=True).start()


def emit(payload):
    PROTOCOL_OUTPUT.write(json.dumps(payload, separators=(",", ":")) + "\n")
    PROTOCOL_OUTPUT.flush()


def require_single_cuda():
    import torch

    gpu_uuid = os.environ.get("CUDA_VISIBLE_DEVICES", "")
    if not GPU_UUID_PATTERN.fullmatch(gpu_uuid):
        raise RuntimeError("A full NVIDIA GPU UUID must be the only visible CUDA device")
    if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
        raise RuntimeError("Chatterbox requires exactly one visible CUDA device")
    return torch


def require_package_version():
    installed = version("chatterbox-tts")
    if installed != PACKAGE_VERSION:
        raise RuntimeError(f"Chatterbox package {PACKAGE_VERSION} is required, found {installed}")


def snapshot(local_only):
    from huggingface_hub import snapshot_download

    return snapshot_download(
        repo_id=MODEL_REPOSITORY,
        revision=MODEL_REVISION,
        allow_patterns=MODEL_PATTERNS,
        local_files_only=local_only,
    )


def prefetch():
    require_package_version()
    require_single_cuda()
    snapshot(False)
    emit(
        {
            "type": "ready",
            "backend": BACKEND,
            "package_version": PACKAGE_VERSION,
            "model_revision": MODEL_REVISION,
            "cuda_devices": 1,
            "sample_rate": 24000,
        }
    )


def load_model():
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    require_package_version()
    torch = require_single_cuda()
    model_path = snapshot(True)
    model = ChatterboxTurboTTS.from_local(model_path, "cuda")
    return model, torch


def request_object(raw_line):
    request = json.loads(raw_line)
    if not isinstance(request, dict):
        raise ValueError("Request frame must be an object")
    return request


def request_lines():
    buffered = bytearray()
    while True:
        chunk = os.read(sys.stdin.fileno(), 8192)
        if not chunk:
            if buffered:
                raise ValueError("Request frame is incomplete")
            return
        offset = 0
        while offset < len(chunk):
            newline = chunk.find(b"\n", offset)
            end = len(chunk) if newline == -1 else newline
            segment = chunk[offset:end]
            if len(buffered) + len(segment) > MAX_LINE_BYTES:
                raise ValueError("Request frame is too large")
            buffered.extend(segment)
            if newline == -1:
                break
            yield bytes(buffered)
            buffered.clear()
            offset = newline + 1


def request_id(request):
    value = request.get("id")
    if not isinstance(value, str) or not value:
        raise ValueError("Request id is required")
    return value


def synthesis_request(request):
    identifier = request_id(request)
    text = request.get("text")
    voice_path = request.get("voice_path")
    output_path = request.get("output_path")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Speech text is required")
    if len(text) > MAX_TEXT_CHARACTERS:
        raise ValueError(f"Speech text cannot exceed {MAX_TEXT_CHARACTERS} characters")
    if not isinstance(voice_path, str) or not isinstance(output_path, str):
        raise ValueError("Managed speech paths are required")
    voice = Path(voice_path)
    output = Path(output_path)
    if not voice.is_absolute() or not voice.is_file():
        raise ValueError("Voice reference is unavailable")
    if not output.is_absolute() or output.suffix.lower() != ".wav" or not output.parent.is_dir():
        raise ValueError("Speech output path is invalid")
    if output.exists():
        raise ValueError("Speech output already exists")
    return identifier, text, voice.resolve(), output.resolve()


def synthesize(model, torch, request):
    import torchaudio

    identifier, text, voice_path, output_path = synthesis_request(request)
    with torch.inference_mode():
        waveform = model.generate(text, audio_prompt_path=str(voice_path))
    torchaudio.save(str(output_path), waveform.float(), model.sr, format="wav")
    output_path.chmod(0o600)
    emit(
        {
            "type": "synthesize",
            "id": identifier,
            "output_path": str(output_path),
            "sample_rate": model.sr,
        }
    )


def serve():
    model, torch = load_model()
    emit(
        {
            "type": "ready",
            "backend": BACKEND,
            "package_version": PACKAGE_VERSION,
            "model_revision": MODEL_REVISION,
            "cuda_devices": 1,
            "sample_rate": model.sr,
        }
    )
    for raw_line in request_lines():
        identifier = None
        try:
            request = request_object(raw_line)
            identifier = request.get("id") if isinstance(request.get("id"), str) else None
            operation = request.get("type")
            if operation == "synthesize":
                synthesize(model, torch, request)
            elif operation == "shutdown":
                identifier = request_id(request)
                emit({"type": "shutdown", "id": identifier})
                return
            else:
                raise ValueError("Unknown worker operation")
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            emit({"type": "error", "id": identifier, "message": str(error)})


def main():
    try:
        bind_parent_lifetime()
        if sys.argv[1:] == ["--prefetch"]:
            prefetch()
        elif sys.argv[1:]:
            raise ValueError("Unknown worker arguments")
        else:
            serve()
        return 0
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        emit({"type": "error", "id": None, "message": str(error)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
