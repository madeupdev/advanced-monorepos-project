import Link from "next/link";
import { notFound } from "next/navigation";
import { PosterArt } from "@madeup-video/ui";
import { RentButton } from "../../../components/rent-button";
import { getTitleFromApi } from "../../../lib/api";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type TitlePageProps = {
  params: Promise<{ id: string }>;
};

export default async function TitlePage({ params }: TitlePageProps) {
  const { id } = await params;
  const title = await getTitleFromApi(id);

  if (!title) {
    notFound();
  }

  const availability =
    title.availability.available === 0
      ? "All copies are currently rented"
      : `${title.availability.available} of ${title.availability.total} ${title.availability.total === 1 ? "copy is" : "copies are"} available`;

  return (
    <div className={`container ${styles.page}`}>
      <Link className={styles.back} href="/">
        ← Back to browse
      </Link>
      <article className={styles.detail}>
        <PosterArt
          className={styles.poster}
          artworkKey={title.artworkKey}
          title={title.name}
        />
        <div className={styles.content}>
          <p className="eyebrow">{title.genre}</p>
          <h1>{title.name}</h1>
          <ul className={styles.metadata} aria-label="Film details">
            <li>{title.releaseYear}</li>
            <li>{title.certificate}</li>
            <li>{title.runtimeMinutes} minutes</li>
          </ul>
          <p className={styles.synopsis}>{title.synopsis}</p>
          <div className={styles.availability}>
            <strong>{availability}</strong>
            <span>Physical VHS copies, rented for seven nights.</span>
          </div>
          {title.availability.available > 0 ? (
            <RentButton titleId={title.id} titleName={title.name} />
          ) : (
            <p className={styles.unavailable}>All copies are currently rented</p>
          )}
        </div>
      </article>
    </div>
  );
}
