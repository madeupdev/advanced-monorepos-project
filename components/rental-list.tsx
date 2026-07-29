import type { RentalSummary } from "../lib/contracts";
import { PosterArt } from "./poster-art";
import { ReturnButton } from "./return-button";
import styles from "./rental-list.module.css";

type RentalListProps = {
  rentals: RentalSummary[];
};

const dateFormatter = new Intl.DateTimeFormat("en-IE", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function RentalList({ rentals }: RentalListProps) {
  return (
    <ul className={styles.list}>
      {rentals.map((rental) => (
        <li key={rental.id}>
          <article className={styles.rental}>
            <PosterArt
              className={styles.poster}
              artworkKey={rental.artworkKey}
              title={rental.titleName}
            />
            <div className={styles.content}>
              <div>
                <p className={styles.status}>Active rental</p>
                <h2>{rental.titleName}</h2>
              </div>
              <dl className={styles.details}>
                <div>
                  <dt>Copy</dt>
                  <dd>{rental.copyBarcode}</dd>
                </div>
                <div>
                  <dt>Member</dt>
                  <dd>{rental.customerName}</dd>
                </div>
                <div>
                  <dt>Rented</dt>
                  <dd>{dateFormatter.format(new Date(rental.rentedAt))}</dd>
                </div>
                <div>
                  <dt>Due back</dt>
                  <dd>{dateFormatter.format(new Date(rental.dueAt))}</dd>
                </div>
              </dl>
              <ReturnButton rentalId={rental.id} titleName={rental.titleName} />
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
