import ScreenHeader from "../../components/ScreenHeader.jsx";
import { buttonsPerRow } from "../../editor/toolbarLayout.js";
import { useVisibleViewport } from "../../editor/useToolbarSize.js";
import ActionListEditor from "./ActionListEditor.jsx";

export default function PopupSettings(props) {
  const viewport = useVisibleViewport();
  return <section>
    <ScreenHeader title="Selection pop-up" onBack={props.onBack} busy={props.busy} />
    <div className="px-4 pb-8">
      <p className="mb-5 text-sm text-[var(--color-muted)]">Shows when you select text. About 8 buttons fit in one row; up to two rows, then ⋯ More.</p>
      <ActionListEditor {...props} preference="selectionMenu" perRow={buttonsPerRow(Math.min(viewport.width, 672) - 22)} />
    </div>
  </section>;
}
