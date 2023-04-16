import * as vscode from "vscode";
import { CodePrompt } from "../prompt";
import { exec } from "node:child_process";
import { readFileSync } from "node:fs";
import { DynamicTool } from "langchain/tools";

export interface Message {
  role: "user" | "assistant" | "system";
  codePrompt?: CodePrompt[];
  text: string;
}

export function createTools() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  let editor = vscode.window.activeTextEditor;

  const readFile = new DynamicTool({
    name: "readFile",
    description:
      "Reads a file in the file system. Expects the relative path as input and outputs the file content.",
    func: async (relativePath: string) => {
      try {
        const readFilePath = relativePath;
        const readFilePathUri = vscode.Uri.file(
          workspaceFolder + "/" + readFilePath
        );
        return readFileSync(readFilePathUri.fsPath, "utf8");
      } catch (e) {
        console.log(e);
        return e instanceof Error ? e.message : "Error reading file";
      }
    },
  });

  const listFiles = new DynamicTool({
    name: "listFiles",
    description:
      "Lists files in a directory relative to the project root. Expects the relative path as input and outputs an array of file names and their types.",
    func: async (relativePath: string) => {
      try {
        const files = await vscode.workspace.fs.readDirectory(
          vscode.Uri.file(workspaceFolder + "/" + relativePath)
        );
        return JSON.stringify(
          files.map((f) => `${f[0]} (${vscode.FileType[f[1]]})`)
        );
      } catch (e) {
        return e instanceof Error ? e.message : "Error listing files";
      }
    },
  });

  const createFile = new DynamicTool({
    name: "createFile",
    description:
      "Creates a new file in the file system. Expects the relative path as input.",
    func: async (relativePath: string) => {
      try {
        const newFileUri = vscode.Uri.file(
          workspaceFolder + "/" + relativePath
        );
        await vscode.workspace.fs.writeFile(newFileUri, new Uint8Array());
        return `File created: ${relativePath}`;
      } catch (e) {
        return e instanceof Error ? e.message : "Error creating file";
      }
    },
  });

  const undo = new DynamicTool({
    name: "undo",
    description: "Undoes the last action in the active editor.",
    func: async () => {
      if (!editor) {
        return "No active editor";
      }
      await vscode.commands.executeCommand("undo");
      return "Undo executed";
    },
  });

  const redo = new DynamicTool({
    name: "redo",
    description: "Redoes the last action in the active editor.",
    func: async () => {
      if (!editor) {
        return "No active editor";
      }
      await vscode.commands.executeCommand("redo");
      return "Redo executed";
    },
  });

  const input = new DynamicTool({
    name: "input",
    description: `Inserts text at a specified location in a file. Expects a JSON with this type path: string; insertLine: number; insertColumn: number; parsedText: string;.`,
    func: async (arg) => {
      try {
        const { path, insertLine, insertColumn, parsedText } = JSON.parse(
          arg
        ) as {
          path: string;
          insertLine: number;
          insertColumn: number;
          parsedText: string;
        };
        if (!editor) {
          throw new Error("No active editor");
        }
        const workspaceFolder =
          vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const inputFileUri = vscode.Uri.file(workspaceFolder + "/" + path);
        let inputDocument: vscode.TextDocument;
        try {
          inputDocument = await vscode.workspace.openTextDocument(inputFileUri);
        } catch (e) {
          await vscode.workspace.fs.writeFile(inputFileUri, new Uint8Array());
          inputDocument = await vscode.workspace.openTextDocument(inputFileUri);
        }
        editor = await vscode.window.showTextDocument(
          inputDocument
        );

        editor.selection = new vscode.Selection(
          insertLine,
          insertColumn,
          insertLine,
          insertColumn
        );
        await editor.edit((editBuilder) => {
          if (!editor) {
            throw new Error("No active editor");
          }
          editBuilder.insert(editor.selection.active, parsedText);
        });
        // get 20 lines before and after the cursor
        const startLineInput = Math.max(
          0,
          editor.selection.active.line - 20
        );
        const endLineInput = Math.min(
          editor.document.lineCount - 1,
          editor.selection.active.line +
            parsedText.split("\n").length +
            20
        );
        const range = new vscode.Range(
          startLineInput,
          0,
          endLineInput,
          editor.document.lineAt(endLineInput).text.length
        );
        const text = editor.document.getText(range);
        return text;
      } catch (e) {
        return e instanceof Error ? e.message : "Error inserting text";
      }
    },
  });

  const select = new DynamicTool({
    name: "select",
    description:
      "Selects text in the active editor. Expects a JSON with this type  startLine: number; startColumn: number; endLine: number; endColumn: number; .",
    func: async (arg) => {
      try {        
        const { startLine, startColumn, endLine, endColumn } = JSON.parse(
          arg
        ) as {
          startLine: number;
          startColumn: number;
          endLine: number;
          endColumn: number;
        };
        if (!editor) {
          throw new Error("No active editor");
        }
        editor.selection = new vscode.Selection(
          startLine,
          startColumn,
          endLine,
          endColumn
        );
        const selectedText = editor.document.getText(
          editor.selection
        );
        return selectedText;
      } catch (e) {
        return e instanceof Error ? e.message : "Error selecting text";
      }
    },
  });

  const replace = new DynamicTool({
    name: "replace",
    description: `Replaces text in a specified range in a file. Expects a JSON with this type  path: string; startLine: number; startColumn: number; endLine: number; endColumn: number; newText: string; .`,
    func: async (arg) => {
      try {
        const { path, startLine, startColumn, endLine, endColumn, newText } =
          JSON.parse(arg) as {
            path: string;
            startLine: number;
            startColumn: number;
            endLine: number;
            endColumn: number;
            newText: string;
          };
        if (!editor) {
          throw new Error("No active editor");
        }
        const workspaceFolder =
          vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const replaceFileUri = vscode.Uri.file(workspaceFolder + "/" + path);
        const replaceDocument = await vscode.workspace.openTextDocument(
          replaceFileUri
        );
        editor = await vscode.window.showTextDocument(
          replaceDocument
        );
        await editor.edit((editBuilder) => {
          editBuilder.replace(
            new vscode.Range(startLine, startColumn, endLine, endColumn),
            newText
          );
        });
        return "Text replaced";
      } catch (e) {
        return e instanceof Error ? e.message : "Error replacing text";
      }
    },
  });

  const copy = new DynamicTool({
    name: "copy",
    description: `Copies text in a specified range in a file. Expects a JSON with this type  path: string; startLine: number; startColumn: number; endLine: number; endColumn: number; .`,
    func: async (arg) => {
      try {
        const { path, startLine, startColumn, endLine, endColumn } = JSON.parse(
          arg
        ) as {
          path: string;
          startLine: number;
          startColumn: number;
          endLine: number;
          endColumn: number;
        };
        const workspaceFolder =
          vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const copyFileUri = vscode.Uri.file(workspaceFolder + "/" + path);
        const copyDocument = await vscode.workspace.openTextDocument(
          copyFileUri
        );
        const copyRange = new vscode.Range(
          startLine,
          startColumn,
          endLine,
          endColumn
        );
        const copyText = copyDocument.getText(copyRange);
        await vscode.env.clipboard.writeText(copyText);
        return "Text copied";
      } catch (e) {
        return e instanceof Error ? e.message : "Error copying text";
      }
    },
  });

  const cut = new DynamicTool({
    name: "cut",
    description: `Cuts text in a specified range in a file. Expects a JSON with this type path: string; startLine: number; startColumn: number; endLine: number; endColumn: number;.`,
    func: async (arg) => {
      try {
        const { path, startLine, startColumn, endLine, endColumn } = JSON.parse(
          arg
        ) as {
          path: string;
          startLine: number;
          startColumn: number;
          endLine: number;
          endColumn: number;
        };
        if (!editor) {
          throw new Error("No active editor");
        }
        const workspaceFolder =
          vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const cutFileUri = vscode.Uri.file(workspaceFolder + "/" + path);
        const cutDocument = await vscode.workspace.openTextDocument(cutFileUri);
        const cutRange = new vscode.Range(
          startLine,
          startColumn,
          endLine,
          endColumn
        );
        const cutText = cutDocument.getText(cutRange);
        await vscode.env.clipboard.writeText(cutText);
        await editor.edit((editBuilder) => {
          editBuilder.delete(cutRange);
        });
        return "Text cut";
      } catch (e) {
        return e instanceof Error ? e.message : "Error cutting text";
      }
    },
  });

  const paste = new DynamicTool({
    name: "paste",
    description: `Pastes text from the clipboard at a specified location in a file. Expects a JSON with this type  path: string; line: number; column: number; .`,
    func: async (arg) => {
      try {
        const { path, line, column } = JSON.parse(arg) as {
          path: string;
          line: number;
          column: number;
        };
        if (!editor) {
          throw new Error("No active editor");
        }
        const workspaceFolder =
          vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const pasteFileUri = vscode.Uri.file(workspaceFolder + "/" + path);
        const pasteDocument = await vscode.workspace.openTextDocument(
          pasteFileUri
        );
        const pasteText = await vscode.env.clipboard.readText();
        const pasteRange = new vscode.Range(line, column, line, column);
        editor = await vscode.window.showTextDocument(
          pasteDocument
        );
        await editor.edit((editBuilder) => {
          if (!editor) {
            throw new Error("No active editor");
          }
          editBuilder.insert(pasteRange.start, pasteText);
        });
        return "Text pasted";
      } catch (e) {
        return e instanceof Error ? e.message : "Error pasting text";
      }
    },
  });
  
  const runInTerminal = new DynamicTool({
    name: "runInTerminal",
    description: `Runs a command in the terminal. Expects the command to be executed`,
    func: async (terminalCommand) => {
      try {
        // Open a confirmation modal in VS Code
        const confirmation = await vscode.window.showInformationMessage(
          `Allow PromptMate to run "${terminalCommand}" in the terminal?`,
          "Allow",
          "Cancel"
        );
        
        if (confirmation !== "Allow") {
          return "user cancelled command";
        }

        const output = await new Promise((resolve, reject) => {
          exec(
            terminalCommand,
            {
              cwd: workspaceFolder,
            },
            (error, stdout, stderr) => {
              if (error) {
                console.log(`error: ${error.message}`);
                resolve(error.message);
                return;
              }
              if (stderr) {
                console.log(`stderr: ${stderr}`);
                resolve(stderr);
                return;
              }
              resolve(stdout);
            }
          );
        });
        
        return output as string;
      } catch (e) {
        return e instanceof Error ? e.message : "Error running command";
      }
    },
  });

  return [
    readFile,
    listFiles,
    createFile,
    undo,
    redo,
    input,
    select,
    replace,
    copy,
    cut,
    paste,
    runInTerminal
  ];
}
