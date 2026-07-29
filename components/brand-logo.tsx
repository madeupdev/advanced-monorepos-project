import styles from "./brand-logo.module.css";

type BrandLogoProps =
  | {
      variant: "full";
      className?: string;
    }
  | {
      variant: "icon";
      label: string;
      className?: string;
    };

export function BrandLogo(props: BrandLogoProps) {
  const className = [styles.logo, props.className].filter(Boolean).join(" ");

  return (
    <span
      className={className}
      aria-label={props.variant === "icon" ? props.label : undefined}
    >
      <svg
        className={styles.mark}
        viewBox="0 0 64 48"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="3" y="5" width="58" height="38" rx="5" fill="none" stroke="currentColor" strokeWidth="4" />
        <rect x="12" y="12" width="40" height="17" rx="2" fill="currentColor" />
        <circle cx="23" cy="20.5" r="5" fill="var(--color-cream)" />
        <circle cx="41" cy="20.5" r="5" fill="var(--color-cream)" />
        <path d="M18 36h28M25 29l-5 7M39 29l5 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {props.variant === "full" ? (
        <span className={styles.wordmark}>Made Up Video</span>
      ) : null}
    </span>
  );
}
