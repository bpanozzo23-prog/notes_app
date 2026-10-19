import { notebookAccess } from "../db/db.js";
import { newId } from "../lib/ids.js";

export const canStartClaudeRequest = (access) => !access.readOnly && !access.replaced && !access.versionChange;

export function createClaudeSession(access = notebookAccess) {
  let snapshot = { conversation: null, proposal: null, suggestions: null, request: null, pendingScope: { kind: "notebook" } };
  let current = null, controller;
  const listeners = new Set();
  const emit = (patch) => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
  const token = () => Object.freeze({ id: newId(), generation: access.getGeneration() });
  const isCurrent = (value) => value != null && value === current && value.generation === access.getGeneration();
  function invalidateSession() {
    const previous = controller;
    controller = null;
    current = token(); // Invalidate before abort listeners can run.
    emit({ conversation: null, proposal: null, suggestions: null, request: null, pendingScope: { kind: "notebook" } });
    previous?.abort();
  }
  const stop = access.subscribe(() => {
    const state = access.getSnapshot();
    if (state.replaced || state.versionChange) invalidateSession();
  });
  return {
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    beginRequest(kind) {
      if (snapshot.request || !canStartClaudeRequest(access.getSnapshot())) return null;
      controller = new AbortController();
      current = token();
      emit({ request: { kind, token: current, generation: current.generation } });
      return { token: current, signal: controller.signal };
    },
    isCurrent,
    endRequest(value) { if (isCurrent(value)) { controller = null; emit({ request: null }); } },
    cancelRequest() {
      const previous = controller;
      controller = null;
      current = token();
      emit({ request: null, ...((snapshot.request && snapshot.request.kind !== "ask") ? { proposal: null } : {}), ...(snapshot.conversation?.turns ? { conversation: { ...snapshot.conversation,
        turns: snapshot.conversation.turns.map((turn) => turn.status === "running" ? { ...turn, status: "stopped" } : turn),
      } } : {}) });
      previous?.abort();
    },
    setPendingScope(scope) { emit({ pendingScope: { ...scope } }); },
    setConversation(value, conversation) { if (isCurrent(value)) emit({ conversation: conversation === null ? null : { ...conversation, token: value, generation: value.generation } }); },
    setProposal(value, proposal) { if (isCurrent(value)) emit({ proposal: proposal === null ? null : { ...proposal, token: value, generation: value.generation } }); },
    prepareProposal(payload, { keepSuggestions = false } = {}) {
      if (snapshot.request) return false;
      const suggestions = payload.kind !== "merge" ? null : keepSuggestions && snapshot.proposal?.kind === "duplicates" && snapshot.proposal.status === "ready" ? snapshot.proposal : snapshot.suggestions;
      emit({ suggestions, proposal: { id: newId(), kind: payload.kind, payload, handles: payload.handles, generation: payload.generation, status: "disclosure" } });
      return true;
    },
    restoreSuggestions() {
      if (snapshot.request || !snapshot.suggestions) return false;
      emit({ proposal: { ...snapshot.suggestions, status: "ready", dismissed: false }, suggestions: null });
      return true;
    },
    updateProposal(id, patch) { if (snapshot.proposal?.id === id) emit({ proposal: { ...snapshot.proposal, ...patch } }); },
    discardProposal() {
      if ((snapshot.request && snapshot.request.kind !== "ask")) this.cancelRequest();
      emit({ proposal: null });
    },
    clearConversation() {
      if (snapshot.request?.kind === "ask") this.cancelRequest();
      emit({ conversation: null, pendingScope: { kind: "notebook" } });
    },
    clearSession: invalidateSession,
    invalidateSession,
    notebookReplaced: () => invalidateSession("local-import"),
    hasContent: () => snapshot.conversation !== null || snapshot.proposal !== null || snapshot.suggestions !== null,
    isBusy: () => snapshot.request !== null,
    dispose: stop,
  };
}
export const claudeSession = createClaudeSession();
