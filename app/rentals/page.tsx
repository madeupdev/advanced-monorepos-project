import Link from "next/link";
import { RentalList } from "../../components/rental-list";
import { listActiveRentals } from "../../lib/rentals";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function RentalsPage() {
  const rentals = await listActiveRentals();

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.heading}>
        <p className="eyebrow">Jamie Vega&apos;s membership</p>
        <h1>My rentals</h1>
        <p>
          Active physical copies are listed here until they are returned to the
          shop.
        </p>
      </header>
      {rentals.length > 0 ? (
        <RentalList rentals={rentals} />
      ) : (
        <div className={styles.empty}>
          <h2>Your rental bag is empty</h2>
          <p>Choose something from the shelves and make tonight a movie night.</p>
          <Link href="/">Browse available titles →</Link>
        </div>
      )}
    </div>
  );
}
