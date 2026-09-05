export function Icon({
  name,
  className = "",
  size,
  filled,
}: {
  name: string;
  className?: string;
  size?: number;
  filled?: boolean;
}) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{
        fontSize: size ? `${size}px` : undefined,
        fontVariationSettings: filled ? "'FILL' 1" : undefined,
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}