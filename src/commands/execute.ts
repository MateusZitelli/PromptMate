import { Command } from "./parse";
import * as vscode from "vscode";
import { CodePrompt } from "../prompt";
import { exec } from 'node:child_process';
import { readFileSync } from "node:fs";

export interface Message {
  role: "user" | "assistant" | "system";
  codePrompt?: CodePrompt[];
  text: string;
}

interface CommandsContext {
	state: {
		codePrompts: CodePrompt[];
		currentUserRequest: string;
		editor: vscode.TextEditor | undefined;
		panel: vscode.WebviewPanel | undefined;
    memory: string;
    conversationHistory: Message[];
	},
	actions: {
		loadUI: () => void;
	}
}

export const createExecuteCommands = (context: CommandsContext) => async (commands: Command[]): Promise<CommandsContext["state"]> => {
	let { editor, codePrompts, currentUserRequest, panel, memory, conversationHistory } = context.state;
	const { loadUI } = context.actions;
  for (const command of commands) {
    console.log("Executing command: " + command);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    let copy = false;

    const args = command.args;
    switch (command.name) {
      case "readFile":
        if (!editor) {
          throw new Error("No active editor");
        }
        const readFilePath = args[0];
        const readFilePathUri = vscode.Uri.file(workspaceFolder + "/" + readFilePath);
        const content = readFileSync(readFilePathUri.fsPath, 'utf8');
        
        codePrompts = [
          ...codePrompts,
          {
            type: "file",
            location: readFilePath,
            content: content,
          }
        ];
        loadUI();
        break;
      case "listFiles":
        // read the directory relative to the project root
        const files = await vscode.workspace.fs.readDirectory(
          vscode.Uri.file(workspaceFolder + "/" + args[0])
        );
        const fileStrings = files.map(
          (f) => `${f[0]} (${vscode.FileType[f[1]]})`
        );
        currentUserRequest += `response to @listFiles ${
          args[0]
        }:\n\`\`\`\n${fileStrings.join("\n")}\n\`\`\``;
        await panel?.webview.postMessage({
          type: "userRequest",
          userRequest: currentUserRequest,
        });
        break;
      case "createFile":
        const newFileUri = vscode.Uri.file(workspaceFolder + "/" + args[0]);
        await vscode.workspace.fs.writeFile(newFileUri, new Uint8Array());
        break;
      case "undo":
        if (!editor) {
          throw new Error("No active editor");
        }
        await vscode.commands.executeCommand("undo");
        break;
      case "redo":
        if (!editor) {
          throw new Error("No active editor");
        }
        vscode.commands.executeCommand("redo");
        break;
      case "input":
        if (!editor) {
          throw new Error("No active editor");
        }
        const path = args[0];
        const insertLine = args[1];
        const insertColumn = args[2];
        const parsedText = args[3];
        const inputFileUri = vscode.Uri.file(workspaceFolder + "/" + path);
        let inputDocument: vscode.TextDocument;
        try {
          inputDocument = await vscode.workspace.openTextDocument(inputFileUri);
        } catch (e) {
          await vscode.workspace.fs.writeFile(inputFileUri, new Uint8Array());
          inputDocument = await vscode.workspace.openTextDocument(inputFileUri);
        }
        editor = await vscode.window.showTextDocument(inputDocument);

        editor.selection = new vscode.Selection(
          parseInt(insertLine),
          parseInt(insertColumn),
          parseInt(insertLine),
          parseInt(insertColumn)
        );
        await editor.edit((editBuilder) => {
          if (!editor) {
            throw new Error("No active editor");
          }
          editBuilder.insert(editor.selection.active, parsedText);
        });
        // get 20 lines before and after the cursor
        const startLineInput = Math.max(0, editor.selection.active.line - 20);
        const endLineInput = Math.min(
          editor.document.lineCount - 1,
          editor.selection.active.line + parsedText.split("\n").length + 20
        );
        const range = new vscode.Range(
          startLineInput,
          0,
          endLineInput,
          editor.document.lineAt(endLineInput).text.length
        );
        const text = editor.document.getText(range);
        currentUserRequest += `response to @input:\n\`\`\`\n${text}\n\`\`\``;
        await panel?.webview.postMessage({
          type: "userRequest",
          userRequest: currentUserRequest,
        });
        break;
      case "select":
        if (!editor) {
          throw new Error("No active editor");
        }
        const startLine = parseInt(args[0]);
        const startColumn = parseInt(args[1]);
        const endLine = parseInt(args[2]);
        const endColumn = parseInt(args[3]);
        editor.selection = new vscode.Selection(
          startLine,
          startColumn,
          endLine,
          endColumn
        );
        const selectedText = editor.document.getText(editor.selection);
        currentUserRequest += `response to @select:\n\`\`\`\n${selectedText}\n\`\`\``;
        await panel?.webview.postMessage({
          type: "userRequest",
          userRequest: currentUserRequest,
        });
        break;
      case "replace":
        if (!editor) {
          throw new Error("No active editor");
        }
        const replacePath = args[0];
        const replaceStartLine = parseInt(args[1]);
        const replaceStartColumn = parseInt(args[2]);
        const replaceEndLine = parseInt(args[3]);
        const replaceEndColumn = parseInt(args[4]);
        const replaceText = args[5];
        const replaceFileUri = vscode.Uri.file(
          workspaceFolder + "/" + replacePath
        );
        const replaceDocument = await vscode.workspace.openTextDocument(
          replaceFileUri
        );
        editor = await vscode.window.showTextDocument(replaceDocument);
        await editor.edit((editBuilder) => {
          editBuilder.replace(
            new vscode.Range(
              replaceStartLine,
              replaceStartColumn,
              replaceEndLine,
              replaceEndColumn
            ),
            replaceText
          );
        });
        break;
      case "copy":
        copy = true;
      case "cut":
        if (!editor) {
          throw new Error("No active editor");
        }
        const cutPath = args[0];
        const copyStartLine = parseInt(args[1]);
        const copyStartColumn = parseInt(args[2]);
        const copyEndLine = parseInt(args[3]);
        const copyEndColumn = parseInt(args[4]);
        const copyRange = new vscode.Range(
          copyStartLine,
          copyStartColumn,
          copyEndLine,
          copyEndColumn
        );
        const cutDocument = await vscode.workspace.openTextDocument(
          vscode.Uri.file(workspaceFolder + "/" + cutPath)
        );
        const copyText = cutDocument.getText(copyRange);
        vscode.env.clipboard.writeText(copyText);
        if (!copy) {
          await editor.edit((editBuilder) => {
            editBuilder.delete(copyRange);
          });
        }
        break;
      case "paste":
        if (!editor) {
          throw new Error("No active editor");
        }
        const pastePath = args[0];
        const pasteLine = parseInt(args[1]);
        const pasteColumn = parseInt(args[2]);
        const pasteDocument = await vscode.workspace.openTextDocument(
          vscode.Uri.file(workspaceFolder + "/" + pastePath)
        );
        const pasteText = await vscode.env.clipboard.readText();
        const pasteRange = new vscode.Range(
          pasteLine,
          pasteColumn,
          pasteLine,
          pasteColumn
        );
        editor = await vscode.window.showTextDocument(pasteDocument);

        await editor.edit((editBuilder) => {
          if (!editor) {
            throw new Error("No active editor");
          }
          editBuilder.insert(pasteRange.start, pasteText);
        });

        break;
      case "getSyntaxErrors":
        if (!editor) {
          throw new Error("No active editor");
        }
        const diagnostics = vscode.languages.getDiagnostics(
          editor.document.uri
        );
        const syntaxErrors = diagnostics.filter(
          (d) => d.severity === vscode.DiagnosticSeverity.Error
        );
        const syntaxErrorMessages = syntaxErrors.map((d) => d.message);
        const syntaxErrorLines = syntaxErrors.map((d) => d.range.start.line);
        const syntaxErrorColumns = syntaxErrors.map(
          (d) => d.range.start.character
        );
        const syntaxErrorLengths = syntaxErrors.map(
          (d) => d.range.end.character - d.range.start.character
        );
        const syntaxErrorData = syntaxErrorMessages.map((m, i) => {
          return {
            message: m,
            line: syntaxErrorLines[i],
            column: syntaxErrorColumns[i],
            length: syntaxErrorLengths[i],
          };
        });
        currentUserRequest += `response to @getSyntaxErrors:\n\`\`\`\n${JSON.stringify(
          syntaxErrorData,
          null,
          2
        )}\n\`\`\``;
        panel?.webview.postMessage({
          type: "syntaxErrors",
          userRequest: currentUserRequest,
        });
        break;
      case "search":
        const query = args[0];
        const searchResults: {
          file: vscode.Uri;
          range: vscode.Range;
          preview: {
            text: string;
            matches: vscode.Range[];
          };
        }[] = await vscode.commands.executeCommand(
          "workbench.action.findInFiles",
          {
            query,
            triggerSearch: true,
            isRegex: true,
            isCaseSensitive: false,
            isWordMatch: false,
            filesToInclude: "**/*",
            filesToExclude: "**/node_modules/**",
            useExcludesAndIgnoreFiles: true,
            previewOptions: {
              matchLines: 1,
              charsPerLine: 100,
            },
          }
        );
        console.log(JSON.stringify(searchResults));
        const searchResultsData = searchResults.map((r) => {
          return {
            file: r.file.fsPath,
            line: r.range.start.line,
            column: r.range.start.character,
            length: r.range.end.character - r.range.start.character,
          };
        });

        currentUserRequest += `response to @search:\n\`\`\`\n${JSON.stringify(
          searchResultsData,
          null,
          2
        )}\n\`\`\``;
        panel?.webview.postMessage({
          type: "searchResults",
          userRequest: currentUserRequest,
        });
        break;
      case "runInTerminal":
        const terminalCommand = args[0];

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

        currentUserRequest += `response to @runInTerminal:\n\`\`\`\n${output}\n\`\`\``;
        await panel?.webview.postMessage({
          type: "userRequest",
          userRequest: currentUserRequest,
        });
        break;
      case "memoryWrite":
        const data = args[0];
        memory += data;
        break;
      case "readMemory":
        currentUserRequest += `response to @readMemory:\n\`\`\`\n${memory}\n\`\`\``;
        await panel?.webview.postMessage({
          type: "userRequest",
          userRequest: currentUserRequest,
        });
        break;
      case "clearMemory":
        memory = "";
        break;
      case "clearConversation":
        conversationHistory = [];
        break;
      default:
        console.log("Unknown command:", command);
    }
  }
	
	return {
		codePrompts,
		currentUserRequest,
		editor,
		panel,
    memory,
    conversationHistory,
	};
};
