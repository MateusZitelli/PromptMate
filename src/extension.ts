import * as vscode from "vscode";
import { micromark } from "micromark";
import * as ts from "typescript";
import "dotenv/config";
import path = require("path");
import html from "./index.html";
import { askGPT, getModels } from "./services";

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

interface Message {
  role: "user" | "assistant" | "system";
  codePrompt?: Prompt[];
  text: string;
}

type Prompt = FunctionPrompt | FilePrompt | SelectionPrompt;

export function activate(context: vscode.ExtensionContext) {
  let panel: vscode.WebviewPanel | undefined;
  let conversationHistory: Message[] = [];
  let loading = false;
  let codePrompt: Prompt[] = [];
  let lastActiveEditor: vscode.TextEditor | undefined =
    vscode.window.activeTextEditor;
  let currentUserRequest = "";
  let models: string[] = [];
  let token: string | undefined = context.globalState.get(
    "openaiUserToken",
    ""
  );
  let renderMarkdown = true;
  let model = context.globalState.get("openaiModel", "gpt-3.5-turbo");

  const loadUI = () => {
    if (panel) {
      panel.reveal();
      return;
    }
    panel = createWebviewPanel();
    panel.onDidDispose(() => {
      panel = undefined;
    });

    panel?.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "askGPT" && !loading && token) {
        await handleAskGPTEvent(message);
      } else if (message.type === "updateToken") {
        context.globalState.update("openaiUserToken", message.token);
        token = message.token;
        await loadModels();
      } else if (message.type === "updateModel") {
        context.globalState.update("openaiModel", message.model);
        model = message.model;
      } else if (message.type === "addPrompt") {
        codePrompt = await handleAddPromptEvent(
          lastActiveEditor,
          codePrompt,
          message.prompt
        );
      } else if (message.type === "removePrompt") {
        codePrompt.splice(message.index, 1);
      } else if (message.type === "updateQuestion") {
        currentUserRequest = message.userRequest;
      } else if (message.type === "init") {
        if (token) {
          await loadModels();
        }
      } else if (message.type === "clearConversation") {
        conversationHistory = [];
      }else if (message.type === "toggleMarkdown") { 
        handleToggleMarkdownEvent();
      }

      await updateUI();
    });
  };

  const updateUI = async () => {
    await panel?.webview.postMessage({
      type: "conversationUpdate",
      conversationHistory: conversationHistory.map((m) => ({
        role: m.role,
        content: renderMarkdown ? micromark(m.text) : m.text,
        isMarkdown: renderMarkdown,
        codePrompt: m.codePrompt ? [...m.codePrompt] : undefined,
      })),
    });
    await panel?.webview.postMessage({ type: "loading", loading });
    await panel?.webview.postMessage({
      type: "prompt",
      prompt: codePrompt ? [...codePrompt] : undefined,
    });
    await panel?.webview.postMessage({ type: "token", token });
    await panel?.webview.postMessage({
      type: "currentFullPrompt",
      fullPrompt: buildPrompt(codePrompt, currentUserRequest),
    });
    await panel?.webview.postMessage({ type: "model", model });
    await panel?.webview.postMessage({ type: "models", models });
  };
  
  const handleToggleMarkdownEvent = async () => {
    renderMarkdown = !renderMarkdown;
    updateUI();
  };
      

  const handleAskGPTEvent = async (message: any) => {
    if (loading) {
      return;
    }
    loading = true;
    conversationHistory.push({
      role: "user",
      codePrompt: [...codePrompt],
      text: message.userRequest,
    });
    await updateUI();
    const response = await askGPT(
      message.token,
      conversationHistory.map((m) => ({
        role: m.role,
        content: buildPrompt(m.codePrompt, m.text),
      })),
      model
    );
    if (!response.ok) {
      conversationHistory.splice(-1);
      vscode.window.showErrorMessage("Failed to fetch response, try again.");
    } else {
      conversationHistory.push({
        role: "assistant",
        text: response.data,
      });
      clearCurrentPrompt();
    }
    loading = false;
  };

  const clearCurrentPrompt = () => {
    codePrompt = [];
    currentUserRequest = "";
    panel?.webview.postMessage({
      type: "userRequest",
      userRequest: "",
    });
  };

  const loadModels = async () => {
    if (!token) {
      vscode.window.showErrorMessage(
        "Failed to fetch models, please check your token"
      );
      return;
    }
    const response = await getModels(token);
    if (!response.ok) {
      vscode.window.showErrorMessage(
        "Failed to fetch models, please check your token"
      );
      return;
    }
    models = response.data
      .filter((m) => m.id.includes("gpt-"))
      .map((m) => m.id);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("promptmate.open", async () => {
      loadUI();
      await updateUI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("promptmate.addFile", async () => {
      const promptToAdd = await handleAddPromptEvent(
        lastActiveEditor,
        codePrompt,
        "file"
      );
      codePrompt = promptToAdd;
      loadUI();
      await updateUI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("promptmate.addFunction", async () => {
      const promptToAdd = await handleAddPromptEvent(
        lastActiveEditor,
        codePrompt,
        "function"
      );
      codePrompt = promptToAdd;
      loadUI();
      await updateUI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("promptmate.addSelection", async () => {
      const promptToAdd = await handleAddPromptEvent(
        lastActiveEditor,
        codePrompt,
        "selection"
      );
      codePrompt = promptToAdd;
      loadUI();
      await updateUI();
    })
  );

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor) {
        lastActiveEditor = editor;
      }
    },
    null,
    context.subscriptions
  );
}

const buildPrompt = (codePrompt: Prompt[] | undefined, userRequest: string) => {
  return codePrompt
    ? `${promptToText(codePrompt)}\n# User request\n${userRequest}`
    : userRequest;
};

const promptToText = (prompt: Prompt[]) => {
  return prompt
    .map((p) => {
      if (p.type === "function") {
        return `# function "${p.name}" @ "${p.location}:${p.startLine}"\n${p.content}\n`;
      } else if (p.type === "file") {
        return `# file @ "${p.location}"\n${p.content}\n`;
      } else if (p.type === "selection") {
        return `# selection @ "${p.location}:${p.startLine}\n${p.content}\n`;
      }
    })
    .join("\n");
};

async function handleAddPromptEvent(
  editor: vscode.TextEditor | undefined,
  currentPrompt: Prompt[],
  promptEvent: string
): Promise<Prompt[]> {
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

// Add the findSelectedFunction function
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

function createWebviewPanel(): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    "promptmate",
    "PromptMate",
    {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
    },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = html;

  return panel;
}

export function deactivate() {}
