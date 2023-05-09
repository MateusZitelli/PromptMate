import { PromptTemplate } from "langchain/prompts";

const _DEFAULT_SUMMARIZER_TEMPLATE = `Progressively summarize the lines of conversation provided, adding onto the previous summary returning a new summary.

EXAMPLE
Current summary:
- Human asked for the list of files in the folder ./src
- Agent used the tool to list files and answered with a list of files of a JavaScript VS Code extension
- Human asked what this project was about
- Agent used the tool to read a file and read the extension.ts file, and answered with a description of the project


New lines of conversation:
Human: Implement tests for extension.ts
AI: I just create extension.test.ts with tests for your file.

New summary:
- Human was exploring and understanding the project
- Agent listed the ./src folder, identified it is a VS Code extension, and read the extension.ts file and answered with a description of the project
- Human: Implement tests for extension.ts
- AI: I just create extension.test.ts with tests for extensions.ts.
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
