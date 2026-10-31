import { existsSync } from "node:fs";
import path from "node:path";

export type HeroSlide = { src: string; alt: string; title?: string; body?: string; links?: { label: string; href: string; solid?: boolean; tone?: "tan" }[] };

export const HERO_VIDEO = {
  src: "/hero/gemini_generated_video_6fd4173d.mp4",
  label: "StreetSavy campaign video",
} as const;

const SLIDE_COPY: Record<string, Pick<HeroSlide, "alt" | "title" | "body" | "links">> = {
  "slide-01": {
    alt: "Seasonal smocks and shirts",
    title: "SEASONAL SMOCKS & SHIRTS",
    links: [{ label: "Explore the range", href: "/collections/shirts", solid: true }],
  },
  "slide-02": {
    alt: "New Sierra suede",
    title: "NEW SIERRA SUEDE",
    links: [
      { label: "Shop now", href: "/collections/men", solid: true },
      { label: "Explore the lookbook", href: "/collections/featured" },
    ],
  },
  "slide-03": {
    alt: "Join the family",
    title: "JOIN THE FAMILY",
    body: "Get exclusive benefits and rewards by joining and becoming an active member of our family.",
    links: [{ label: "Sign up", href: "/contact", tone: "tan" }],
  },
  "slide-05": {
    alt: "Autumn volume 2",
    title: "AUTUMN VOL. 2",
    links: [
      { label: "Shop men's", href: "/collections/men" },
      { label: "Shop women's", href: "/collections/women" },
    ],
  },
};

const NAMES = ["slide-01", "slide-02", "slide-03", "slide-04", "slide-05"];
const EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

/** Images live in public/ (slide-01.jpg …) or public/hero/. */
export function heroSlides(): HeroSlide[] {
  const root = path.join(process.cwd(), "public");
  return NAMES.flatMap((name) => {
    for (const folder of ["", "hero"]) {
      for (const extension of EXTENSIONS) {
        const relative = folder ? path.join(folder, `${name}${extension}`) : `${name}${extension}`;
        if (existsSync(path.join(root, relative))) return [{ src: `/${relative.split(path.sep).join("/")}`, alt: "", ...SLIDE_COPY[name] }];
      }
    }
    return [];
  });
}
