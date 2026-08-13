"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./rental-actions.module.css";

type ReturnButtonProps = {
  rentalId: string;
  titleName: string;
};

type ErrorPayload = {
  error?: {
    message?: string;
  };
};

const browserApiOrigin =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

export function ReturnButton({ rentalId, titleName }: ReturnButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function returnCopy() {
    setPending(true);
    setError("");

    try {
      const response = await fetch(
        `${browserApiOrigin}/api/rentals/${rentalId}/return`,
        { method: "POST" },
      );

      if (!response.ok) {
        const payload = (await response.json()) as ErrorPayload;
        throw new Error(payload.error?.message ?? "The copy could not be returned.");
      }

      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The copy could not be returned.",
      );
      setPending(false);
    }
  }

  return (
    <div className={styles.action}>
      <button
        className={styles.secondary}
        type="button"
        disabled={pending}
        onClick={returnCopy}
      >
        {pending ? `Returning ${titleName}…` : "Return this copy"}
      </button>
      <div className={styles.message} aria-live="polite">
        {error ? <span className={styles.error}>{error}</span> : null}
      </div>
    </div>
  );
}
