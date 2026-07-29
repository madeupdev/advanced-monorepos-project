import styles from "./poster-art.module.css";

type PosterArtProps = {
  artworkKey: string;
  title: string;
  className?: string;
};

const artworkClasses: Record<string, string> = {
  "midnight-rewind": styles.midnightRewind,
  "signal-lost": styles.signalLost,
  "weekend-at-orion": styles.weekendAtOrion,
  "the-last-matinee": styles.lastMatinee,
  "rental-hearts": styles.rentalHearts,
  "static-summer": styles.staticSummer,
};

export function PosterArt({ artworkKey, title, className }: PosterArtProps) {
  const artworkClass = artworkClasses[artworkKey] ?? styles.fallback;
  const classes = [styles.poster, artworkClass, className].filter(Boolean).join(" ");

  return (
    <div className={classes} aria-hidden="true">
      <span className={styles.shapeOne} />
      <span className={styles.shapeTwo} />
      <span className={styles.kicker}>Made Up Pictures</span>
      <span className={styles.title}>{title}</span>
      <span className={styles.spine}>VHS</span>
    </div>
  );
}
