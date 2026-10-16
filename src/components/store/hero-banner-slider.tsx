"use client";

import Link from "next/link";
import { Swiper, SwiperSlide } from "swiper/react";
import { Navigation, Pagination, A11y } from "swiper/modules";
import type { HeroSlide } from "../../lib/store/hero-slides.ts";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

export function HeroBannerSlider({ slides }: { slides: HeroSlide[] }) {
  const canLoop = slides.length > 1;

  if (slides.length === 0) {
    return (
      <div className="store-hero-empty" role="img" aria-label="Hero images not configured">
        Add images to public/hero/
      </div>
    );
  }

  return (
    <div className={`store-hero-swiper-wrap${canLoop ? "" : " is-single"}`}>
      <Swiper
        className="store-hero-swiper"
        modules={[Navigation, Pagination, A11y]}
        slidesPerView={1}
        spaceBetween={0}
        loop={canLoop}
        navigation={canLoop}
        pagination={canLoop ? { clickable: true } : false}
        a11y={{ prevSlideMessage: "Previous slide", nextSlideMessage: "Next slide" }}
      >
        {slides.map((slide, index) => (
          <SwiperSlide key={slide.src} className="store-hero-slide">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="store-hero-slide-img"
              src={slide.src}
              alt={slide.alt}
              decoding="async"
              loading={index === 0 ? "eager" : "lazy"}
            />
            {(slide.title || slide.body || slide.links?.length) && (
              <div className="store-hero-caption">
                {slide.title && <p className="store-hero-caption-title">{slide.title}</p>}
                {slide.body && <p className="store-hero-caption-body">{slide.body}</p>}
                {!!slide.links?.length && (
                  <div className="store-hero-caption-links">
                    {slide.links.map((link) => (
                      <Link key={link.href} className={link.tone === "tan" ? "is-tan" : link.solid ? "is-solid" : undefined} href={link.href}>{link.label}</Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
