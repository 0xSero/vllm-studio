import { describe, expect, it } from "vitest";
import { createStateMachine } from "./state-machine";

type State = { count: number };
type Event = { type: "add"; value: number } | { type: "reset" };
type Context = { max: number };
type Effect = string;

describe("createStateMachine", () => {
  it("dispatches transitions, exposes current state, and returns effects", () => {
    const machine = createStateMachine<State, Event, Context, Effect>({
      initialState: { count: 1 },
      transition: (state, context, event) => {
        if (event.type === "reset") {
          return { state: { count: 0 }, effects: ["reset"] };
        }
        const count = Math.min(context.max, state.count + event.value);
        return { state: { count }, effects: [`count:${count}`] };
      },
    });

    expect(machine.state).toEqual({ count: 1 });
    expect(machine.dispatch({ type: "add", value: 5 }, { max: 4 })).toEqual({
      state: { count: 4 },
      effects: ["count:4"],
    });
    expect(machine.state).toEqual({ count: 4 });
  });

  it("supports explicit setState and reset to the original initial state", () => {
    const machine = createStateMachine<State, Event, Context, Effect>({
      initialState: { count: 3 },
      transition: () => ({ state: { count: 99 }, effects: [] }),
    });

    machine.setState({ count: 8 });
    expect(machine.state).toEqual({ count: 8 });
    machine.reset();
    expect(machine.state).toEqual({ count: 3 });
  });
});
