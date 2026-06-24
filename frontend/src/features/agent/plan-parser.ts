// Pure, dependency-free parsing/serialization for the agent Plan pane.
//
// The plan is stored as Markdown (Cursor-style: a `### To-dos` section with
// `- [ ]` / `- [x]` checkbox lines). This module is the single source of truth
// for turning that Markdown into structured todos and writing status changes
// back, and is shared by both the server store and the client pane. In practice
// models sometimes omit the leading list marker (`[ ] task`), so parsing accepts
// both forms and status rewrites preserve the user's original shape.

export type PlanTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type PlanTodo = {
  id: string;
  content: string;
  status: PlanTodoStatus;
  /** Index of the source checkbox line within the Markdown, for round-tripping. */
  lineIndex: number;
};

// Matches a Markdown checkbox item, capturing indent, optional bullet, status
// mark, body. Accepted forms: `- [ ] task`, `* [ ] task`, `+ [ ] task`, and
// `[ ] task`.
// Accepted marks: " " pending, "x"/"X" completed, "-" cancelled,
// "~"/">"/"/" in progress.
const TODO_LINE = /^(\s*)(?:([-*+]\s+)?)\[([ xX~>/-])\]\s?(.*)$/;

export function markToStatus(mark: string): PlanTodoStatus {
  switch (mark) {
    case "x":
    case "X":
      return "completed";
    case "-":
      return "cancelled";
    case "~":
    case ">":
    case "/":
      return "in_progress";
    default:
      return "pending";
  }
}

export function statusToMark(status: PlanTodoStatus): string {
  switch (status) {
    case "completed":
      return "x";
    case "cancelled":
      return "-";
    case "in_progress":
      return "/";
    default:
      return " ";
  }
}

export function parsePlanTodos(markdown: string): PlanTodo[] {
  const lines = markdown.split("\n");
  const todos: PlanTodo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = TODO_LINE.exec(lines[i]);
    if (!match) continue;
    todos.push({
      id: `todo-${i}`,
      content: match[4].trim(),
      status: markToStatus(match[3]),
      lineIndex: i,
    });
  }
  return todos;
}

// Rewrite the checkbox mark on the given source line to reflect `status`.
// Returns the original markdown unchanged if the line is not a checkbox.
export function setTodoStatusAtLine(
  markdown: string,
  lineIndex: number,
  status: PlanTodoStatus,
): string {
  const lines = markdown.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return markdown;
  const match = TODO_LINE.exec(lines[lineIndex]);
  if (!match) return markdown;
  const [, indent, bullet = "", , body] = match;
  lines[lineIndex] = `${indent}${bullet}[${statusToMark(status)}] ${body}`;
  return lines.join("\n");
}

const STATUS_CYCLE: PlanTodoStatus[] = ["pending", "in_progress", "completed", "cancelled"];

export function nextStatus(status: PlanTodoStatus): PlanTodoStatus {
  const index = STATUS_CYCLE.indexOf(status);
  return STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length];
}

export function planProgress(todos: PlanTodo[]): { done: number; total: number } {
  const total = todos.filter((todo) => todo.status !== "cancelled").length;
  const done = todos.filter((todo) => todo.status === "completed").length;
  return { done, total };
}
