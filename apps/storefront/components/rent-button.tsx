"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./rental-actions.module.css";

type RentButtonProps = {
  titleId: string;
  titleName: string;
};

type ErrorPayload = {
  error?: {
    message?: string;
  };
};

const browserApiOrigin =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

export function RentButton({ titleId, titleName }: RentButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [rented, setRented] = useState(false);
  const [error, setError] = useState("");

  async function rent() {
    setPending(true);
    setError("");

    try {
      const response = await fetch(`${browserApiOrigin}/api/rentals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ titleId }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as ErrorPayload;
        throw new Error(payload.error?.message ?? "The rental could not be completed.");
      }

      setRented(true);
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The rental could not be completed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.action}>
      <button
        className={styles.primary}
        type="button"
        disabled={pending || rented}
        onClick={rent}
      >
        {pending ? `Renting ${titleName}…` : rented ? "Copy rented" : "Rent for 7 nights"}
      </button>
      <div className={styles.message} aria-live="polite">
        {rented ? (
          <span>
            Ready for movie night. <Link href="/rentals">View my rentals</Link>
          </span>
        ) : null}
        {error ? <span className={styles.error}>{error}</span> : null}
      </div>
    </div>
  );
}
