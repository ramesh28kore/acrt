import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { CodeEditor, ResultPanel } from "@/components/coding/CodeEditor";
import type { GradeResult } from "@/lib/coding/grading";

const result: GradeResult = {
  verdict: "WRONG_ANSWER",
  sampleResults: [
    {
      input: "2",
      expected: "4",
      stdout: "5",
      stderr: "",
      exitCode: 0,
      signal: null,
      timeMs: 3,
      passed: false,
    },
  ],
  hiddenPassed: 1,
  hiddenTotal: 3,
  passedTotal: 1,
  total: 4,
  allPassed: false,
};

describe("result panel", () => {
  it("shows the verdict label, sample details and only counts for hidden cases", () => {
    const { container } = render(<ResultPanel result={result} kind="submit" />);
    expect(screen.getByRole("heading", { name: "Wrong Answer" })).toBeInTheDocument();
    expect(screen.getByText(/1 of 4 cases passed/)).toBeInTheDocument();
    expect(screen.getByText(/hidden cases: 1 of 3/)).toBeInTheDocument();
    expect(container.textContent).toContain("Your output");
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("labels each verdict plainly", () => {
    const { rerender } = render(
      <ResultPanel result={{ ...result, verdict: "TIME_LIMIT" }} kind="run" />,
    );
    expect(screen.getByRole("heading", { name: "Time Limit Exceeded" })).toBeInTheDocument();
    rerender(<ResultPanel result={{ ...result, verdict: "RUNTIME_ERROR" }} kind="run" />);
    expect(screen.getByRole("heading", { name: "Runtime Error" })).toBeInTheDocument();
    rerender(
      <ResultPanel result={{ ...result, verdict: "ACCEPTED", allPassed: true }} kind="run" />,
    );
    expect(screen.getByRole("heading", { name: "Accepted" })).toBeInTheDocument();
  });
});

describe("code editor", () => {
  function Harness() {
    const [value, setValue] = useState("x = 1");
    return <CodeEditor label="Editor" value={value} onChange={setValue} />;
  }

  it("is labelled, edits text and indents with Tab instead of moving focus", () => {
    render(<Harness />);
    const editor = screen.getByLabelText("Editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "y = 2" } });
    expect(editor.value).toBe("y = 2");
    editor.setSelectionRange(0, 0);
    fireEvent.keyDown(editor, { key: "Tab" });
    expect(editor.value.startsWith("    ")).toBe(true);
  });

  it("scrolls long lines instead of overflowing the page", () => {
    render(<Harness />);
    expect((screen.getByLabelText("Editor") as HTMLTextAreaElement).className).toContain(
      "whitespace-pre",
    );
  });
});
