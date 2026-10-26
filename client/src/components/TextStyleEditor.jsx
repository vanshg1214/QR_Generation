import {
  FONT_FAMILIES,
  WEIGHT_LABELS,
  TEXT_LABELS,
  POINT_SIZE_RANGE,
  SCALE_RANGE,
  isScaledText,
  supportedWeight,
} from "../../../server/src/textStyles.js";

// Pick one of the texts on the page (or click it in the preview), then change its font,
// weight, size and colour. Only texts that are switched on are listed.
export default function TextStyleEditor({
  activeKeys,
  selected,
  onSelect,
  styles,
  defaults,
  onChange,
  colorsAuto,
  onMatchColors,
}) {
  if (!activeKeys.length) return null;
  const style = styles[selected];
  const scaled = isScaledText(selected);
  const [lo, hi] = scaled ? SCALE_RANGE : POINT_SIZE_RANGE;
  const isDefault = JSON.stringify(style) === JSON.stringify(defaults[selected]);

  return (
    <div className="text-style-editor">
      <div className="text-style-tabs" role="tablist" aria-label="Text to edit">
        {activeKeys.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === selected}
            className={`text-style-tab${key === selected ? " is-active" : ""}`}
            onClick={() => onSelect(key)}
          >
            {TEXT_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="text-style-controls">
        <label>
          Font
          <select
            value={style.font}
            onChange={(e) =>
              onChange(selected, { font: e.target.value, weight: supportedWeight(e.target.value, style.weight) })
            }
          >
            {Object.entries(FONT_FAMILIES).map(([value, f]) => (
              <option key={value} value={value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Weight
          <select value={style.weight} onChange={(e) => onChange(selected, { weight: e.target.value })}>
            {FONT_FAMILIES[style.font].weights.map((w) => (
              <option key={w} value={w}>
                {WEIGHT_LABELS[w]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Size
          {scaled ? (
            <input
              type="range"
              min={lo * 100}
              max={hi * 100}
              step={5}
              value={Math.round(style.size * 100)}
              onChange={(e) => onChange(selected, { size: Number(e.target.value) / 100 })}
            />
          ) : (
            <input
              type="range"
              min={lo}
              max={hi}
              step={0.5}
              value={style.size}
              onChange={(e) => onChange(selected, { size: Number(e.target.value) })}
            />
          )}
          <span className="text-size-value">{scaled ? `${Math.round(style.size * 100)}%` : `${style.size}pt`}</span>
        </label>
        <label>
          Colour
          <input type="color" value={style.color} onChange={(e) => onChange(selected, { color: e.target.value })} />
        </label>
        <button type="button" className="secondary" onClick={() => onChange(selected, defaults[selected])} disabled={isDefault}>
          Reset
        </button>
        {scaled && (
          <button type="button" className="secondary" onClick={onMatchColors} disabled={colorsAuto}>
            {colorsAuto ? "Colours matched to graphic" : "Match colours to graphic"}
          </button>
        )}
      </div>
      {scaled && (
        <p className="muted small" style={{ margin: 0 }}>
          Size is relative to the QR box. Text always stays inside the box: if it doesn't fit, it shrinks or wraps —
          make the box bigger for larger text.
        </p>
      )}
    </div>
  );
}
