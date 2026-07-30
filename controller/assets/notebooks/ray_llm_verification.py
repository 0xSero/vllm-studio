import json
import os
import socket
import urllib.request

BASE_URL = os.environ.get("LOCAL_STUDIO_LLM_BASE_URL", "http://172.18.7.206").rstrip("/")
HOST_HEADER = os.environ.get("LOCAL_STUDIO_LLM_HOST", "api.tprime.vlans.ca")
MODEL = os.environ.get("LOCAL_STUDIO_LLM_MODEL", "qwen3-next-80b-a3b-nvfp4")
PROMPT = "Return exactly LOCAL_STUDIO_RAY_NOTEBOOK_OK"
EXPECTED_ANSWER = "LOCAL_STUDIO_RAY_NOTEBOOK_OK"


def ask_local_llm():
    body = json.dumps(
        {
            "model": MODEL,
            "messages": [{"role": "user", "content": PROMPT}],
            "temperature": 0,
        }
    ).encode()
    request = urllib.request.Request(
        f"{BASE_URL}/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Host": HOST_HEADER},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)["choices"][0]["message"]["content"].strip()


answer = ask_local_llm()
assert answer == EXPECTED_ANSWER
print(f"LOCAL_LLM model={MODEL} answer={answer}")

if os.environ.get("RAY_ADDRESS"):
    import ray

    ray.init()

    @ray.remote
    def verify_task(index):
        return {"task": index, "host": socket.gethostname(), "value": 2 + 2}

    results = ray.get([verify_task.remote(index) for index in range(4)])
    print(
        "RAY_NOTEBOOK "
        + json.dumps(
            {
                "answer": answer,
                "driver": socket.gethostname(),
                "resources": {
                    key: value
                    for key, value in ray.cluster_resources().items()
                    if key in ("CPU", "GPU")
                },
                "tasks": results,
            },
            sort_keys=True,
        )
    )
