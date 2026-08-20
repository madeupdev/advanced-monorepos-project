import { useEffect, useState } from "react";
import { BrandLogo } from "@madeup-video/ui";
import { listRentals, listTitles } from "./api";
import type { RentalSummary, TitleSummary } from "@madeup-video/contracts";
import "./app.css";

type View = "titles" | "copies" | "rentals";

function TitlesPage({ titles }: { titles: TitleSummary[] }) {
  return <section><h1>Inventory desk</h1><p>Titles available through the shared rental API.</p><div className="grid">{titles.map((title) => <article key={title.id}><h2>{title.name}</h2><p>{title.genre} · {title.releaseYear}</p><strong>{title.availability.available} available of {title.availability.total} total</strong></article>)}</div></section>;
}

function CopiesPage({ titles }: { titles: TitleSummary[] }) {
  return <section><h1>Physical copies</h1><p>Stock is grouped by title; the API owns copy availability.</p><div className="grid">{titles.map((title) => <article key={title.id}><h2>{title.name}</h2><p>{title.availability.available} available of {title.availability.total} total</p><meter min="0" max={title.availability.total} value={title.availability.available}>{title.availability.available}</meter></article>)}</div></section>;
}

function RentalsPage({ rentals }: { rentals: RentalSummary[] }) {
  return <section><h1>Active rentals</h1>{rentals.length === 0 ? <p>No active rentals</p> : <div className="grid">{rentals.map((rental) => <article key={rental.id}><h2>{rental.titleName}</h2><p>{rental.copyBarcode} · {rental.customerName}</p><p>Due {new Date(rental.dueAt).toLocaleDateString()}</p></article>)}</div>}</section>;
}

export function App() {
  const [view, setView] = useState<View>("titles");
  const [titles, setTitles] = useState<TitleSummary[]>([]);
  const [rentals, setRentals] = useState<RentalSummary[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => { Promise.all([listTitles(), listRentals()]).then(([nextTitles, nextRentals]) => { setTitles(nextTitles); setRentals(nextRentals); }).catch(() => setError("Inventory data is unavailable. Check the API connection.")); }, []);

  return <><a className="skip" href="#content">Skip to content</a><header><BrandLogo variant="full" /><span>Staff inventory</span><nav aria-label="Admin views">{(["titles", "copies", "rentals"] as const).map((item) => <a key={item} href={`#${item}`} onClick={(event) => { event.preventDefault(); setView(item); }}>{item[0].toUpperCase() + item.slice(1)}</a>)}</nav></header><main id="content">{error ? <p role="alert">{error}</p> : view === "titles" ? <TitlesPage titles={titles} /> : view === "copies" ? <CopiesPage titles={titles} /> : <RentalsPage rentals={rentals} />}</main></>;
}
