import { initTimeline } from "./timeline.ts";

const WIDTH = 1280;
const HEIGHT = 720;

const deck = document.querySelector<HTMLElement>(".deck")!;
const slides = [...document.querySelectorAll<HTMLElement>(".slide")];
const progress = document.querySelector<HTMLElement>(".progress-bar")!;
const counter = document.querySelector<HTMLElement>(".counter")!;

const state = { slide: 0, step: 0 };

const stepsOf = (i: number) => Number(slides[i]?.dataset.steps ?? 0);

function fit() {
  const scale = Math.min(window.innerWidth / WIDTH, (window.innerHeight - 44) / HEIGHT);
  deck.style.transform = `scale(${scale})`;
}

function render() {
  slides.forEach((slide, i) => {
    const active = i === state.slide;
    slide.classList.toggle("active", active);
    slide.classList.toggle("before", i < state.slide);
    if (!active) return;
    slide.dataset.now = String(state.step);
    for (let k = 1; k <= stepsOf(i); k++) slide.classList.toggle(`s${k}`, k <= state.step);
    slide.querySelectorAll<HTMLElement | SVGElement>("[data-step]").forEach((el) => {
      el.classList.toggle("on", Number(el.dataset.step) <= state.step);
    });
    slide.querySelectorAll<HTMLElement>("[data-only]").forEach((el) => {
      el.classList.toggle("on", el.dataset.only!.split(",").map(Number).includes(state.step));
    });
    slide.dispatchEvent(new CustomEvent("step", { detail: state.step }));
  });

  const total = slides.reduce((n, _, i) => n + stepsOf(i) + 1, 0);
  const done = slides.slice(0, state.slide).reduce((n, _, i) => n + stepsOf(i) + 1, 0) + state.step + 1;
  progress.style.width = `${(done / total) * 100}%`;
  counter.textContent = `${state.slide + 1} / ${slides.length}`;
  history.replaceState(null, "", `#${state.slide + 1}.${state.step}`);
}

function go(slide: number, step: number) {
  state.slide = Math.max(0, Math.min(slides.length - 1, slide));
  state.step = Math.max(0, Math.min(stepsOf(state.slide), step));
  render();
}

function next() {
  if (state.step < stepsOf(state.slide)) go(state.slide, state.step + 1);
  else if (state.slide < slides.length - 1) go(state.slide + 1, 0);
}

function prev() {
  if (state.step > 0) go(state.slide, state.step - 1);
  else if (state.slide > 0) go(state.slide - 1, stepsOf(state.slide - 1));
}

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
    case "Enter":
      next();
      break;
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
      prev();
      break;
    case "Home":
      go(0, 0);
      break;
    case "End":
      go(slides.length - 1, stepsOf(slides.length - 1));
      break;
    case "f":
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
      break;
    default:
      return;
  }
  e.preventDefault();
});

document.querySelector(".nav-prev")!.addEventListener("click", prev);
document.querySelector(".nav-next")!.addEventListener("click", next);
window.addEventListener("resize", fit);

initTimeline(document.querySelector<HTMLElement>("#timing")!);

const [slide, step] = location.hash.slice(1).split(".").map(Number);
fit();
go((slide || 1) - 1, step || 0);
