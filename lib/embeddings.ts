export async function getEmbeddings(text: string): Promise<number[]> {

    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
            "authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
            input: text,
            dimensions: 768
        })
    })
    if (!response.ok) {
        throw new Error(`Embedding API failed: ${response.status}`);
    }

    const data = await response.json();
    const embedding = data?.data?.[0]?.embedding;
    if (!embedding) {
        throw new Error("No Embeddings returned");
    }
    return embedding;

}

