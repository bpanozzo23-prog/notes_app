import Spike from "./Spike.jsx";

// The whole app is the editor spike for now. The real shell (note list, folders, settings)
// replaces this once the spike has answered whether Tiptap behaves with Samsung Keyboard.
export default function App() {
  return <Spike />;
}
