import { statusText, statusStyle, DOTS } from '../utils/statusStyle';

export default function StatusBadge({ status, variant = 'default' }) {
  const text = statusText(status);
  const classes = statusStyle(status);

  if (variant === 'dot') {
    // Dot takes the badge's hue, so the two never disagree.
    const dot = DOTS[classes.match(/text-([a-z]+)-/)?.[1]] || DOTS.gray;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        {text}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset ${classes}`}>
      {text}
    </span>
  );
}
