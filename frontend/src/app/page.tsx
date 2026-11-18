"use client";

import {
  useEffect,
} from "react";

import {
  useRouter,
} from "next/navigation";


export default function Home() {
  const router =
    useRouter();

  useEffect(() => {
    router.replace(
      "/login",
    );
  }, [
    router,
  ]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p
        role="status"
        className="text-sm text-[#687178]"
      >
        Opening sign in...
      </p>
    </main>
  );
}