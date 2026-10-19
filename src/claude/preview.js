// The owner's first line without the text projection's heading, list, task or link markers.
export const notePreview = (text) => text.split("\n")[0].replace(/^(?:#{1,6} |> |- |\d+\. |\[(?: |x)\] |\[(?:Note|Tip|Warning|Important)\]$)+/, "").replace(/ \[→ [^\]]*\]/g, "").trim() || "(empty note)";
