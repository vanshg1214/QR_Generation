import {
  FONT_FAMILIES,
  WEIGHT_LABELS,
  TEXT_LABELS,
  POINT_SIZE_RANGE,
  SCALE_RANGE,
  isScaledText,
  supportedWeight,
} from "../../../server/src/textStyles.js";

const SWATCHES = ["#1a1a1a", "#404040", "#ffffff", "#123c2c", "#1f7a4d", "#0b3d91", "#b3261e", "#c9a227"];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Pick one of the texts on the page (or click it in the preview), then change its font,
// weight, size and colour; the preview next to it updates as you go. Only texts that are
// switched on are listed.
export default function TextStyleEditor({
  activeKeys,
  selected,
  onSelect,
  styles,
  defaults,
  onChange,
  colorsAuto,
  onMatchColors,
  graphicColors = [], // colours suggested from the graphic, offered as swatches too
}) {
  if (!activeKeys.length) {
    return (
      <section className="design-section">
        <h3>Text style</h3>
        <p className="muted small">Switch on some text above (greeting, name under the QR or signature) to style it.</p>
      </section>
    );
  }
  const style = styles[selected];
  const scaled = isScaledText(selected);
  const [lo, hi] = scaled ? SCALE_RANGE : POINT_SIZE_RANGE;
  const step = scaled ? 0.05 : 0.5;
  const isDefault = JSON.stringify(style) === JSON.stringify(defaults[selected]);
  const setSize = (v) => onChange(selected, { size: Math.round(clamp(v, lo, hi) / step) * step });
  const swatches = [...new Set([...graphicColors, ...SWATCHES].map((c) => c.toLowerCase()))];

  return (
    <section className="design-section text-style-editor">
      <h3>Text style</h3>
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

      <div className="style-field">
        <span className="style-field-label">Font</span>
        <select
          value={style.font}
          onChange={(e) => onChange(selected, { font: e.target.value, weight: supportedWeight(e.target.value, style.weight) })}
        >
          {Object.entries(FONT_FAMILIES).map(([value, f]) => (
            <option key={value} value={value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div className="style-field">
        <span className="style-field-label">Weight</span>
        <div className="segmented" role="radiogroup" aria-label="Weight">
          {FONT_FAMILIES[style.font].weights.map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={style.weight === w}
              className={style.weight === w ? "is-active" : ""}
              onClick={() => onChange(selected, { weight: w })}
            >
              {WEIGHT_LABELS[w]}
            </button>
          ))}
        </div>
      </div>

      <div className="style-field">
        <span className="style-field-label">Size</span>
        <div className="size-control">
          <button type="button" className="secondary icon-button" onClick={() => setSize(style.size - step)} disabled={style.size <= lo} aria-label="Smaller">
            −
          </button>
          <input
            type="range"
            min={lo}
            max={hi}
            step={step}
            value={style.size}
            onChange={(e) => setSize(Number(e.target.value))}
            aria-label="Size"
          />
          <button type="button" className="secondary icon-button" onClick={() => setSize(style.size + step)} disabled={style.size >= hi} aria-label="Bigger">
            +
          </button>
          <span className="text-size-value">{scaled ? `${Math.round(style.size * 100)}%` : `${style.size}pt`}</span>
        </div>
      </div>

      <div className="style-field">
        <span className="style-field-label">Colour</span>
        <div className="swatches">
          {swatches.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${style.color === c ? " is-active" : ""}`}
              style={{ background: c }}
              onClick={() => onChange(selected, { color: c })}
              aria-label={`Colour ${c}`}
              title={graphicColors.map((g) => g.toLowerCase()).includes(c) ? `${c} (from the graphic)` : c}
            />
          ))}
          <label className="swatch swatch-custom" title="Pick any colour">
            <input type="color" value={style.color} onChange={(e) => onChange(selected, { color: e.target.value })} aria-label="Custom colour" />
          </label>
          <span className="muted small">{style.color}</span>
        </div>
      </div>

      <div className="button-row">
        <button type="button" className="secondary small-button" onClick={() => onChange(selected, defaults[selected])} disabled={isDefault}>
          Reset this text
        </button>
        {scaled && (
          <button type="button" className="secondary small-button" onClick={onMatchColors} disabled={colorsAuto}>
            {colorsAuto ? "Colours matched to graphic" : "Match colours to graphic"}
          </button>
        )}
      </div>
      {scaled && (
        <p className="muted small" style={{ margin: 0 }}>
          Size is relative to the QR box. The text always stays inside the box: if it doesn't fit it shrinks or wraps, so
          make the box bigger for larger text.
        </p>
      )}
    </section>
  );
}
