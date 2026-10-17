import { useState } from "react";
import ScreenHeader from "../../components/ScreenHeader.jsx";
import Toolbar from "../../editor/Toolbar.jsx";
import { buttonsPerRow } from "../../editor/toolbarLayout.js";
import { setPref } from "../../db/db.js";
import ActionListEditor from "./ActionListEditor.jsx";

export default function ToolbarSettings(props) {
  const { formatting, busy, readOnly, onBack, run, refresh } = props;
  const [perRow, setPerRow] = useState(() => buttonsPerRow(Math.min(window.innerWidth, 672) - 16));
  return <section>
    <ScreenHeader title="Toolbar" onBack={onBack} busy={busy} />
    <div className="px-4 pb-8">
      <fieldset disabled={busy || readOnly} className="mb-4">
        <legend className="font-semibold">Layout</legend>
        {[["scroll", "One row, swipe"], ["rows", "Two rows"], ["more", "One row + More"]].map(([value, label]) =>
          <label key={value} className="flex min-h-11 items-center gap-3 text-sm">
            <input type="radio" name="toolbar-layout" value={value} checked={formatting.toolbarLayout === value}
              onChange={() => { if (!readOnly) run(async () => { await setPref("toolbarLayout", value); await refresh(); }); }} />{label}
          </label>)}
      </fieldset>
      <h2 className="mb-2 font-semibold">Preview</h2>
      <div className="toolbar-preview -mx-4 mb-5 border-b border-[var(--color-line)]">
        <Toolbar ids={formatting.toolbar} layout={formatting.toolbarLayout} formatting={formatting} onCapacity={setPerRow} />
      </div>
      <ActionListEditor {...props} preference="toolbar" perRow={perRow} />
    </div>
  </section>;
}
