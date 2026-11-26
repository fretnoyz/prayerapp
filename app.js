const STORAGE_KEY = "quietly-prayers";
const form = document.querySelector("#prayer-form");
const input = document.querySelector("#prayer-input");
const charCount = document.querySelector("#char-count");
const filter = document.querySelector("#prayer-filter");
const list = document.querySelector("#prayer-list");
const count = document.querySelector("#prayer-count");

function readPrayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved)
      ? saved.filter((prayer) =>
        prayer &&
        typeof prayer.id === "string" &&
        typeof prayer.text === "string" &&
        typeof prayer.createdAt === "string" &&
        typeof prayer.answered === "boolean"
      )
      : [];
  } catch {
    return [];
  }
}

let prayers = readPrayers();

function savePrayers() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prayers));
  } catch {
    // The journal remains usable for this visit if browser storage is unavailable.
  }
}

function renderPrayers() {
  list.replaceChildren();
  count.textContent = String(prayers.length);

  const visible = prayers.filter((prayer) => {
    if (filter.value === "active") return !prayer.answered;
    if (filter.value === "answered") return prayer.answered;
    return true;
  });

  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = filter.value === "answered" ? "✧" : "♡";
    const title = document.createElement("h3");
    title.textContent = filter.value === "answered"
      ? "No answered prayers yet"
      : filter.value === "active"
        ? "Nothing waiting in prayer"
        : "A little space to begin";
    const description = document.createElement("p");
    description.textContent = filter.value === "all"
      ? "Your prayers will find a home here."
      : "Try another filter or add a new prayer.";
    empty.append(icon, title, description);
    list.append(empty);
    return;
  }

  for (const prayer of visible) {
    const card = document.createElement("article");
    card.className = `prayer-card${prayer.answered ? " is-answered" : ""}`;

    const symbol = document.createElement("span");
    symbol.className = "prayer-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = prayer.answered ? "✓" : "♡";

    const content = document.createElement("div");
    content.className = "prayer-content";
    const text = document.createElement("p");
    text.className = "prayer-text";
    text.textContent = prayer.text;
    const date = document.createElement("time");
    date.className = "prayer-date";
    date.dateTime = prayer.createdAt;
    date.textContent = new Date(prayer.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    content.append(text, date);

    const actions = document.createElement("div");
    actions.className = "prayer-actions";
    const answerButton = document.createElement("button");
    answerButton.className = "answer-button";
    answerButton.type = "button";
    answerButton.textContent = prayer.answered ? "↶ In prayer" : "✓ Answered";
    answerButton.setAttribute(
      "aria-label",
      `${prayer.answered ? "Move back to in prayer" : "Mark as answered"}: ${prayer.text}`
    );
    answerButton.addEventListener("click", () => {
      prayer.answered = !prayer.answered;
      savePrayers();
      renderPrayers();
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "×";
    deleteButton.setAttribute("aria-label", `Delete prayer: ${prayer.text}`);
    deleteButton.addEventListener("click", () => {
      prayers = prayers.filter((item) => item.id !== prayer.id);
      savePrayers();
      renderPrayers();
    });

    actions.append(answerButton, deleteButton);
    card.append(symbol, content, actions);
    list.append(card);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }

  prayers.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text,
    createdAt: new Date().toISOString(),
    answered: false,
  });
  savePrayers();
  input.value = "";
  charCount.textContent = "0 / 500";
  filter.value = "all";
  renderPrayers();
  input.focus();
});

input.addEventListener("input", () => {
  charCount.textContent = `${input.value.length} / 500`;
});

filter.addEventListener("change", renderPrayers);
renderPrayers();
