import path = require("path");
import ts = require("typescript");
import * as vscode from "vscode";

interface FunctionPrompt {
  type: "function";
  name: string;
  location: string;
  content: string;
  startLine: number;
}

interface FilePrompt {
  type: "file";
  location: string;
  content: string;
}

interface SelectionPrompt {
  type: "selection";
  location: string;
  content: string;
  startLine: number;
}

export type CodePrompt = FunctionPrompt | FilePrompt | SelectionPrompt;

export async function handleAddPromptEvent(
  editor: vscode.TextEditor | undefined,
  currentPrompt: CodePrompt[],
  promptEvent: string
): Promise<CodePrompt[]> {
  if (!editor) {
    vscode.window.showErrorMessage("No active editor found");
    return currentPrompt;
  }

  const document = editor.document;
  const selection = editor.selection;
  const startLine = selection.start.line;
  const selectedText = document.getText(selection);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri
    .fsPath;
  const relativeDir = workspaceFolder
    ? path.relative(workspaceFolder, document.fileName)
    : document.fileName;

  if (promptEvent === "file") {
    // Handle adding entire file content to the prompt
    const fileContent = document.getText();
    // Update the prompt with the file content
    return [
      ...currentPrompt,
      {
        type: "file",
        location: relativeDir,
        content: fileContent,
      },
    ];
  } else if (promptEvent === "function") {
    // Handle adding selected function to the prompt
    const sourceFile = ts.createSourceFile(
      document.fileName,
      document.getText(),
      ts.ScriptTarget.Latest,
      true
    );

    const selectedFunction = findSelectedFunction(
      sourceFile,
      selection.start.line,
      selection.start.character
    );

    if (selectedFunction) {
      // Update the prompt with the selected function
      const startFunctionLine = sourceFile.getLineAndCharacterOfPosition(
        selectedFunction.getStart()
      ).line;
      return [
        ...currentPrompt,
        {
          type: "function",
          name: selectedFunction.name?.getText() ?? "anonymous",
          location: relativeDir,
          content: selectedFunction.getText(),
          startLine: startFunctionLine,
        },
      ];
    } else {
      vscode.window.showErrorMessage(
        "No function found at the current selection"
      );
    }
  } else if (promptEvent === "selection") {
    // Handle adding selected text to the prompt
    // Update the prompt with the selected text
    console.log(selectedText);
    return [
      ...currentPrompt,
      {
        type: "selection",
        location: relativeDir,
        content: selectedText,
        startLine,
      },
    ];
  }
  return currentPrompt;
}

function findSelectedFunction(
  node: ts.Node,
  selectedLine: number,
  selectedCharacter: number
): ts.FunctionDeclaration | ts.ArrowFunction | undefined {
  let foundFunction: ts.FunctionDeclaration | ts.ArrowFunction | undefined;

  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
    try {
      const start = node.getStart();
      const end = node.getEnd();
      const sourceFile = node.getSourceFile();

      if (!sourceFile) {
        console.error("sourceFile is undefined for node:", node);
        return;
      }
      const startPosition = sourceFile.getLineAndCharacterOfPosition(start);
      const endPosition = sourceFile.getLineAndCharacterOfPosition(end);

      if (!startPosition || !endPosition) {
        console.error(
          "startPosition or endPosition is undefined for node:",
          node
        );
        return;
      }

      if (
        startPosition.line <= selectedLine &&
        endPosition.line >= selectedLine
      ) {
        // Check if the function has any child nodes that include the selection
        ts.forEachChild(node, (child) => {
          const result = findSelectedFunction(
            child,
            selectedLine,
            selectedCharacter
          );
          if (result) {
            foundFunction = result;
          }
        });

        // If no child nodes include the selection, return the current function
        if (!foundFunction) {
          foundFunction = node;
        }
      }
    } catch (e) {
      console.error("Error while processing node:", node, e);
    }
  } else {
    ts.forEachChild(node, (child) => {
      const result = findSelectedFunction(
        child,
        selectedLine,
        selectedCharacter
      );
      if (result) {
        foundFunction = result;
      }
    });
  }

  return foundFunction;
}
