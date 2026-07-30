import json
import pathlib
import sys

import nbformat
from nbclient import NotebookClient


def render_output(output):
    output_type = output.get("output_type", "stream")
    if output_type == "stream":
        text = output.get("text", "")
    elif output_type == "error":
        text = "\n".join(output.get("traceback", []))
    else:
        data = output.get("data", {})
        text = data.get("text/plain", json.dumps(data, sort_keys=True))
    return {"type": output_type, "text": str(text)[:20000]}


def document(path):
    notebook = nbformat.read(path, as_version=4)
    kernel_name = notebook.metadata.get("kernelspec", {}).get("name", "python3")
    cells = []
    for index, cell in enumerate(notebook.cells):
        cells.append(
            {
                "index": index,
                "cell_type": cell.cell_type,
                "source": cell.source,
                "execution_count": cell.get("execution_count"),
                "outputs": [render_output(value) for value in cell.get("outputs", [])],
            }
        )
    return {"kernel_name": kernel_name, "cells": cells}


def execute(path, cell_index, timeout_seconds):
    notebook = nbformat.read(path, as_version=4)
    if cell_index < 0 or cell_index >= len(notebook.cells):
        raise ValueError("cell index is outside the notebook")
    if notebook.cells[cell_index].cell_type != "code":
        raise ValueError("only code cells can be executed")
    kernel_name = notebook.metadata.get("kernelspec", {}).get("name", "python3")
    client = NotebookClient(
        notebook,
        timeout=timeout_seconds,
        kernel_name=kernel_name,
        allow_errors=True,
    )
    with client.setup_kernel():
        for index in range(cell_index + 1):
            if notebook.cells[index].cell_type == "code":
                client.execute_cell(notebook.cells[index], index)
    nbformat.write(notebook, path)
    return document(path)


def patch(path, cell_index, source):
    notebook = nbformat.read(path, as_version=4)
    if cell_index < 0 or cell_index >= len(notebook.cells):
        raise ValueError("cell index is outside the notebook")
    notebook.cells[cell_index].source = source
    if notebook.cells[cell_index].cell_type == "code":
        notebook.cells[cell_index].outputs = []
        notebook.cells[cell_index].execution_count = None
    nbformat.write(notebook, path)
    return document(path)


def structure(path, action, cell_index, cell_type=None, direction=None):
    notebook = nbformat.read(path, as_version=4)
    if action == "insert":
        if cell_index < 0 or cell_index > len(notebook.cells):
            raise ValueError("cell index is outside the notebook")
        factories = {
            "code": nbformat.v4.new_code_cell,
            "markdown": nbformat.v4.new_markdown_cell,
            "raw": nbformat.v4.new_raw_cell,
        }
        if cell_type not in factories:
            raise ValueError("unsupported cell type")
        notebook.cells.insert(cell_index, factories[cell_type]())
    elif action == "delete":
        if cell_index < 0 or cell_index >= len(notebook.cells):
            raise ValueError("cell index is outside the notebook")
        notebook.cells.pop(cell_index)
    elif action == "move":
        offset = -1 if direction == "up" else 1 if direction == "down" else 0
        target = cell_index + offset
        if offset == 0 or cell_index < 0 or target < 0 or target >= len(notebook.cells):
            raise ValueError("cell cannot move in that direction")
        notebook.cells[cell_index], notebook.cells[target] = (
            notebook.cells[target],
            notebook.cells[cell_index],
        )
    else:
        raise ValueError("unsupported structure operation")
    nbformat.write(notebook, path)
    return document(path)


def main():
    request = json.loads(
        pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
        if len(sys.argv) > 1
        else sys.stdin.read()
    )
    path = pathlib.Path(request["path"])
    if request["operation"] == "inspect":
        result = document(path)
    elif request["operation"] == "execute":
        result = execute(path, request["cell_index"], request["timeout_seconds"])
    elif request["operation"] == "patch":
        result = patch(path, request["cell_index"], request["source"])
    elif request["operation"] == "structure":
        result = structure(
            path,
            request["action"],
            request["cell_index"],
            request.get("cell_type"),
            request.get("direction"),
        )
    else:
        raise ValueError("unsupported operation")
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
