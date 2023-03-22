import axios from "axios";

const systemPrompt = `You are a helpful assistant that will be helping develop software.
You are going to receive files, functions and selection to give you context.
You can ask me questions about the code and I will try to answer them.
You may request more code snippets to help you understand the code.
Provide code snippets whenever you can.`;

interface ResponseFail {
  ok: false;
}
interface ResponseOk<T> {
  ok: true;
  data: T;
}

export async function askGPT(
  token: string,
  messages: {
		role: "user" | "assistant" | "system";
		content: string;
	}[] = [],
	model: string = "gpt-4"
): Promise<ResponseFail | ResponseOk<string>> {
  const data = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
    temperature: 0.7,
  };

  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };

  try {
    console.log("Sending request to OpenAI...");
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      data,
      config
    );
    console.log("Received response from OpenAI.");
    return {
      data: response.data.choices[0].message.content,
      ok: true,
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.log(JSON.stringify(error.response.data, null, 2));
        console.log(error.response.status);
        console.log(error.response.headers);
      } else if (error.request) {
        // The request was made but no response was received
        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        console.log(error.request);
      } else {
        // Something happened in setting up the request that triggered an Error
        console.log("Error", error.message);
      }
      console.log(error.config);
    }

    return {
      ok: false,
    };
  }
}

export async function getModels(token: string): Promise<ResponseFail | ResponseOk<{
  id: string;
}[]>>  {
  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };

  try {
    console.log("Sending request to OpenAI...");
    const response = await axios.get(
      "https://api.openai.com/v1/models",
      config
    );
    console.log("Received response from OpenAI.");
    return {
      data: response.data.data,
      ok: true,
    };
  }catch(e){
    return {
      ok: false,
    };
  }
}
