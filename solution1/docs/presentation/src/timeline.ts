type Params = { voteWindow: number; voteDuration: number; challengeTime: number };

const X0 = 200;
const X1 = 1180;
const LANE_Y = [78, 128, 178, 228, 278];
const LANE_H = 30;
const AXIS_Y = 330;
const FINALIZE_DELAY = 15;

const LANES = [
  { label: "Vote cells", step: 1 },
  { label: "YES counting + finalize", step: 2 },
  { label: "NO counting + challenge", step: 3 },
  { label: "Pass → grant", step: 3 },
  { label: "Recycle (never finalized)", step: 4 },
];

function geometry(p: Params) {
  const f = p.voteDuration + FINALIZE_DELAY;
  const end = Math.max(f + p.challengeTime, p.voteDuration + p.challengeTime) + 45;
  const start = -12;
  const x = (offset: number) => X0 + ((offset - start) / (end - start)) * (X1 - X0);
  return { f, end, x };
}

function bar(x1: number, x2: number, lane: number, cls: string, text = "") {
  const y = LANE_Y[lane]!;
  const w = Math.max(0, x2 - x1);
  const label =
    text && w > text.length * 7 + 16
      ? `<text x="${x1 + 8}" y="${y + LANE_H / 2 + 5}" class="bar-text">${text}</text>`
      : "";
  return `<rect x="${x1}" y="${y}" width="${w}" height="${LANE_H}" rx="6" class="bar ${cls}"/>${label}`;
}

function marker(x: number, label: string, row: number, cls: string, step: number) {
  const ty = row === 0 ? 22 : 44;
  return `<g class="tl-${step} marker ${cls}">
    <line x1="${x}" x2="${x}" y1="${ty + 6}" y2="${AXIS_Y}" />
    <text x="${x}" y="${ty}" text-anchor="middle">${label}</text>
  </g>`;
}

function draw(svg: SVGSVGElement, p: Params) {
  const { f, end, x } = geometry(p);
  const countableEnd = Math.min(p.voteWindow, f);
  const lanes = LANES.map(
    (l, i) =>
      `<text x="${X0 - 14}" y="${LANE_Y[i]! + LANE_H / 2 + 5}" text-anchor="end" class="lane-label tl-${l.step}">${l.label}</text>`,
  ).join("");

  svg.innerHTML = `
    <defs>
      <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="#eef0f3"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c3c8d0" stroke-width="3"/>
      </pattern>
    </defs>
    ${lanes}
    <line x1="${X0}" x2="${X1}" y1="${AXIS_Y}" y2="${AXIS_Y}" class="axis"/>
    <text x="${X1}" y="${AXIS_Y + 22}" text-anchor="end" class="axis-label">block number →</text>

    <g class="tl-1">${bar(x(0), x(countableEnd), 0, "b-vote", "cast & counted")}</g>
    <g class="tl-2">${bar(x(countableEnd), x(f), 0, "b-late", "cast OK, never counted")}</g>
    <g class="tl-2">${bar(x(p.voteDuration), x(f), 1, "b-count", "count YES")}</g>
    <g class="tl-3">${bar(x(f), x(end), 2, "b-challenge", "challenge any time while finalized")}</g>
    <g class="tl-3">${bar(x(f + p.challengeTime), x(end), 3, "b-pass", "pass allowed")}</g>
    <g class="tl-4">${bar(x(p.voteDuration + p.challengeTime), x(end), 4, "b-recycle", "initiator recycles bond")}</g>

    ${marker(x(0), "P (proposal created)", 0, "m-p", 1)}
    ${marker(x(p.voteWindow), "P + vote_window", 1, "m-vw", 1)}
    ${marker(x(p.voteDuration), "P + vote_duration", 0, "m-vd", 2)}
    ${marker(x(f), "F (finalized)", 1, "m-f", 3)}
    ${marker(x(f + p.challengeTime), "F + challenge_time", 0, "m-ct", 3)}
    ${marker(x(p.voteDuration + p.challengeTime), "P + vote_duration + challenge_time", 1, "m-rc", 4)}

    <g class="cursor"><line x1="0" x2="0" y1="60" y2="${AXIS_Y + 6}"/><circle cx="0" cy="${AXIS_Y}" r="6"/><text x="0" y="${AXIS_Y + 24}" text-anchor="middle">now</text></g>
  `;
}

function cursorOffset(step: number, p: Params) {
  const { f } = geometry(p);
  switch (step) {
    case 0:
      return 0;
    case 1:
      return p.voteWindow / 2;
    case 2:
      return p.voteDuration + FINALIZE_DELAY / 2;
    case 3:
      return f + p.challengeTime + 12;
    default:
      return p.voteDuration + p.challengeTime + 12;
  }
}

export function initTimeline(slide: HTMLElement) {
  const svg = slide.querySelector<SVGSVGElement>("svg.tl")!;
  const inputs = [...slide.querySelectorAll<HTMLInputElement>("input[data-param]")];
  const warning = slide.querySelector<HTMLElement>(".tl-warning")!;
  let step = 0;

  const params = (): Params => {
    const v = (name: string) => Number(inputs.find((i) => i.dataset.param === name)!.value);
    return {
      voteWindow: v("voteWindow"),
      voteDuration: v("voteDuration"),
      challengeTime: v("challengeTime"),
    };
  };

  const moveCursor = () => {
    const p = params();
    const cursor = svg.querySelector<SVGGElement>(".cursor")!;
    cursor.style.transform = `translateX(${geometry(p).x(cursorOffset(step, p))}px)`;
  };

  const update = () => {
    const p = params();
    for (const input of inputs) {
      input.parentElement!.querySelector("output")!.textContent = `${input.value} blocks`;
    }
    draw(svg, p);
    moveCursor();
    warning.textContent =
      p.voteWindow > p.voteDuration
        ? "vote_window > vote_duration: votes can still be cast (and counted) after counting starts, so early counting cells may miss them."
        : "vote_window ≤ vote_duration: the set of countable votes is fixed before anyone starts counting.";
    warning.classList.toggle("warn", p.voteWindow > p.voteDuration);
  };

  inputs.forEach((i) => i.addEventListener("input", update));
  slide.addEventListener("step", (e) => {
    step = (e as CustomEvent<number>).detail;
    moveCursor();
  });
  update();
}
