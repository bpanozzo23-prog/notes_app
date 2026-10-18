// Hand-written, made-up notebook answers. Indices follow createdAt/id, live notes only.
export const notebookCitations = [
  { type: "char_location", document_index: 3, document_title: "Frases para repasar", cited_text: "pretérito vs. imperfecto", start_char_index: 38, end_char_index: 62, file_id: null },
  { type: "char_location", document_index: 1, document_title: "Gramática — ser y estar", cited_text: "Ser for what something is", start_char_index: 17, end_char_index: 42, file_id: null },
  { type: "char_location", document_index: 7, document_title: "Reflexión — octubre", cited_text: "estudiar español diez minutos antes del café", start_char_index: 37, end_char_index: 81, file_id: null },
];
const usage = { input_tokens: 100, cache_creation_input_tokens: 27000, cache_read_input_tokens: 0, output_tokens: 1500 };
export function askEvents({ id = "msg_ask_fixture", model = "claude-opus-5-5", stop = "end_turn", blocks = [], counts = usage } = {}) {
  const events = [{ type: "message_start", message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage: { ...counts, output_tokens: 1 } } }];
  blocks.forEach((block, index) => {
    events.push({ type: "content_block_start", index, content_block: block.type === "text" ? { type: "text", text: "", citations: [] } : block });
    if (block.type === "text") {
      const middle = Math.floor(block.text.length / 2);
      for (const text of [block.text.slice(0, middle), block.text.slice(middle)]) events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text } });
      for (const citation of block.citations ?? []) events.push({ type: "content_block_delta", index, delta: { type: "citations_delta", citation } });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, stop_details: null }, usage: counts }, { type: "message_stop" });
  return events;
}
const thinking = { type: "thinking", thinking: "", signature: "MADE-UP-NOTEBOOK-SIGNATURE" };
export const notebookAnswer = askEvents({ blocks: [thinking,
  { type: "text", text: "Repasa pretérito e imperfecto, y por y para.", citations: [notebookCitations[0], { ...notebookCitations[0], cited_text: "por vs. para", start_char_index: 67, end_char_index: 79 }] },
  { type: "text", text: "\n\nPractica ser y estar con ejemplos de identidad y ubicación.", citations: [notebookCitations[1]] },
  { type: "text", text: "\n\nDedica diez minutos antes del café, como ya te funcionó.", citations: [notebookCitations[2]] },
] });
export const followupAnswer = askEvents({ id: "msg_followup_fixture", counts: { ...usage, input_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 28600, output_tokens: 500 }, blocks: [thinking,
  { type: "text", text: "- Escribe una frase con ser y otra con estar.\n- Mañana repasa por y para.", citations: [notebookCitations[1], notebookCitations[0]] },
] });
export const noteAnswer = askEvents({ id: "msg_note_fixture", counts: { ...usage, cache_creation_input_tokens: 900, output_tokens: 250 }, blocks: [
  { type: "text", text: "Es un paisaje inventado para probar las imágenes. La nota dice que la imagen se guarda con ella.", citations: [{ ...notebookCitations[0], document_index: 0, document_title: "Captura de ejemplo", cited_text: "Un paisaje inventado para probar las imágenes.", start_char_index: 0, end_char_index: 46 }] },
] });
export const refusalAnswer = askEvents({ id: "msg_refusal_fixture", stop: "refusal" });
export const cutAnswer = askEvents({ id: "msg_cut_fixture", stop: "max_tokens", blocks: [{ type: "text", text: "Empieza por repasar los tiempos verbales y", citations: [notebookCitations[0]] }] });
export const overloadedAnswer = [...notebookAnswer.slice(0, 6), { type: "error", error: { type: "overloaded_error", message: "Made-up busy stream" } }];
export const fallbackAnswer = askEvents({ id: "msg_fallback_fixture", model: "claude-opus-4-8", counts: { ...usage, iterations: [{ ...usage, cache_creation: null, model: "claude-opus-4-8", type: "fallback_message" }] }, blocks: [
  { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" }, trigger: { type: "refusal", category: null } },
  { type: "text", text: "Puedes repasar las frases pendientes de tu lista.", citations: [notebookCitations[0]] },
] });
