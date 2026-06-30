import { IconHome, IconInfoCircle } from "@tabler/icons-react"
import Link from "next/link"

export default function PlaygroundPage() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-2 font-medium text-sm text-zinc-600 hover:text-zinc-950"
        >
          <IconHome className="size-4" />
          Dashboard
        </Link>
        <section className="rounded-md border border-zinc-200 bg-white p-6">
          <IconInfoCircle className="size-6 text-blue-600" />
          <h1 className="mt-4 font-semibold text-2xl">
            Open a service playground
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Playground is now scoped to each service so API and workflow presets
            can match the selected function. Open a service from the dashboard,
            then choose the Playground tab.
          </p>
        </section>
      </div>
    </main>
  )
}
