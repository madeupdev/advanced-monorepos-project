import { TitleCard } from "../components/title-card";
import { listTitles } from "../lib/titles";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const titles = await listTitles();

  return (
    <>
      <section className={styles.hero}>
        <div className={`container ${styles.heroInner}`}>
          <div>
            <p className="eyebrow">Tonight deserves a proper movie</p>
            <h1>Take home something unexpected.</h1>
            <p className={styles.heroCopy}>
              Browse our small, carefully made-up collection and rent a physical
              copy for seven days.
            </p>
          </div>
          <aside className={styles.rentalLabel} aria-label="How rentals work">
            <strong>One tape. Seven nights.</strong>
            <span>
              Every availability count represents a real copy on our shelves.
            </span>
          </aside>
        </div>
      </section>
      <section className={`container ${styles.catalogue}`} aria-labelledby="catalogue-title">
        <div className={styles.sectionHeading}>
          <h2 id="catalogue-title">Browse the shelves</h2>
          <p>
            Six original films, selected for rainy evenings, long weekends, and
            the joy of choosing together.
          </p>
        </div>
        {titles.length > 0 ? (
          <ul className={styles.grid}>
            {titles.map((title) => (
              <li key={title.id}>
                <TitleCard title={title} />
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <h3>The shelves are being restocked</h3>
            <p>Please check back soon for tonight&apos;s selection.</p>
          </div>
        )}
      </section>
    </>
  );
}
