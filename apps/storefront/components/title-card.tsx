import Link from "next/link";
import type { TitleSummary } from "@madeup-video/contracts";
import { PosterArt } from "@madeup-video/ui";
import styles from "./title-card.module.css";

type TitleCardProps = {
  title: TitleSummary;
};

export function TitleCard({ title }: TitleCardProps) {
  const availability =
    title.availableCopies === 0
      ? "All copies currently rented"
      : `${title.availableCopies} ${title.availableCopies === 1 ? "copy" : "copies"} available`;

  return (
    <article className={styles.card}>
      <PosterArt
        className={styles.poster}
        artworkKey={title.artworkKey}
        title={title.name}
      />
      <div className={styles.content}>
        <div>
          <p className={styles.genre}>{title.genre}</p>
          <h3>{title.name}</h3>
        </div>
        <ul className={styles.metadata} aria-label={`${title.name} details`}>
          <li>{title.releaseYear}</li>
          <li>{title.certificate}</li>
          <li>{title.runtimeMinutes} min</li>
        </ul>
        <p
          className={
            title.availableCopies > 0 ? styles.available : styles.unavailable
          }
        >
          {availability}
        </p>
        <Link className={styles.link} href={`/titles/${title.id}`}>
          View {title.name} details
        </Link>
      </div>
    </article>
  );
}
