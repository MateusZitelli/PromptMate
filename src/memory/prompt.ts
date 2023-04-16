import { PromptTemplate } from "langchain";

const _DEFAULT_SUMMARIZER_TEMPLATE = `Progressively summarize the lines of conversation provided, adding onto the previous summary returning a new summary.

EXAMPLE
Current summary:
The human asks to list the files in the folder ./src and a list of files of a JavaScript project was returned.

New lines of conversation:
Human: Explain what this project is about.
AI: This project is a VS Code extension called PromptMate.

New summary:
The human asks to list the files in the folder ./src and a list of files of a JavaScript VS Code extension called PromptMate.
END OF EXAMPLE

Current summary:
{summary}

New lines of conversation:
{new_lines}

New summary:`;

// eslint-disable-next-line spaced-comment
export const SUMMARY_PROMPT = /*#__PURE__*/ new PromptTemplate({
  inputVariables: ["summary", "new_lines"],
  template: _DEFAULT_SUMMARIZER_TEMPLATE,
});
