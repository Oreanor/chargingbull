# Meridien Longread Engine

Движок для скролл-лонгридов с тяжёлым ричмедиа (Gaussian Splat, нативное 3D,
карты, видео). Контент пишется в MDX, движок переиспользуется между лонгридами.

**Стек:** Vite · React 18 · TypeScript · MDX · Tailwind · Motion.

---

## Запуск

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # прод-сборка в dist/
npm run preview  # локальный просмотр сборки
```

---

## Ментальная модель

Лонгрид — это **обычный поток DOM** с тремя типами секций:

1. **Прозные** — текст, заголовки, разделители. Никакого JS.
2. **Stage-секции** — sticky-визуал, который анимируется по прогрессу скролла.
   Прогресс — это `MotionValue<number>` от `0` до `1`, его читают потомки.
3. **HeavyBlock-секции** — тяжёлые виджеты (splat, 3D, карта, видео).
   Монтируются при подъезде к вьюпорту, размонтируются при отдалении —
   так Datum SDK получает честный `dispose()`, а не висит в памяти.

Контент в `.mdx`. Движок ничего не знает про конкретный лонгрид —
он умеет только эти три кирпича.

---

## Как написать новый лонгрид

### 1. Создать `.mdx`

```mdx
// src/content/my-story.mdx
import hero from '../assets/hero.png';

<section className="min-h-screen grid place-items-center px-6">
  <h1>My Story</h1>
</section>

<Prose>
  <p>Обычный абзац. Можно вставлять <em>акценты</em> и <strong>жир</strong>.</p>
</Prose>

<Stage stages={3}>
  <div className="absolute inset-0 grid place-items-center">
    <ImageCrossfade images={[img1, img2, img3]} />
  </div>
</Stage>

<HeavyBlock className="w-full h-screen">
  <FakeSplat label="my-scene" />
</HeavyBlock>
```

### 2. Подключить в `App.tsx`

```tsx
import MyStory from './content/my-story.mdx';
import { mdxComponents } from './content/mdx-components';

<Longread>
  <MyStory components={mdxComponents} />
</Longread>
```

### 3. Если нужны кастомные компоненты — добавь в `mdx-components.tsx`

Это карта `<Имя>` → компонент. Всё, что туда положено, доступно в любом MDX
без импортов.

---

## Примитивы движка

### `<Longread>`

Корневой контейнер. Рисует прогресс-бар сверху и оборачивает контент в `<main>`.

```tsx
<Longread>{children}</Longread>
```

### `<Stage stages={N}>`

Sticky-визуал, занимает `N` высот экрана в потоке скролла. Внутренний контейнер
залипает (`position: sticky`), а его потомки получают `scrollYProgress: 0..1`
через контекст. На `progress=0` пользователь только подъехал; на `1` —
вот-вот уедет.

```tsx
<Stage stages={4}>
  <MyAnimatedScene />
</Stage>
```

`stages` ≈ длина зрительного «куска». 2–3 для коротких сцен, 4–6 для длинных
поэтапных. Помни: `stages=4` = 4×100vh реального скролла.

### `useStageProgress()`

Возвращает `MotionValue<number>` текущего Stage. Используй в потомках Stage
для императивной анимации без ре-рендеров:

```tsx
function Caption() {
  const progress = useStageProgress();
  const opacity = useTransform(progress, [0.3, 0.5], [0, 1]);
  return <motion.div style={{ opacity }}>...</motion.div>;
}
```

Под капотом — `motion`'s `useScroll`. Подписчики не ре-рендерятся; меняются
только CSS-свойства через `transform`/`opacity`.

### `<HeavyBlock>`

```tsx
<HeavyBlock
  className="w-full h-screen"
  fallback={<div>not yet loaded</div>}
  mountMargin={1}     // монтировать когда блок ближе 1 экрана
  unmountMargin={1.5} // размонтировать когда блок дальше 1.5 экранов
>
  <DatumViewer src="bull.splat" />
</HeavyBlock>
```

Хост-элемент **должен иметь высоту** (`h-screen`, `min-h-[80vh]`, и т.п.) —
иначе он схлопнется и никогда не пересечётся с вьюпортом.

`unmountMargin={Infinity}` — смонтировать один раз и больше не выгружать.

### `useInViewMount`

Та же логика, но как голый хук — если нужен ручной контроль:

```tsx
const { ref, mounted } = useInViewMount<HTMLDivElement>({ mountMargin: 1 });
return <div ref={ref}>{mounted && <Heavy />}</div>;
```

---

## Готовые контент-компоненты

В `src/components/` лежат блоки общего назначения. Они уже зарегистрированы
в `mdx-components.tsx` и доступны в любом MDX.

| Компонент          | Что делает                                                          |
| ------------------ | ------------------------------------------------------------------- |
| `<ImageCrossfade>` | Кроссфейд серии картинок по прогрессу Stage                         |
| `<Steps>`          | Сайдбар с текстовыми шагами, синхронизирован с Stage-прогрессом     |
| `<Prose>`          | Текстовый блок с типографикой                                       |
| `<Break>`          | Главоразделитель с номером, заголовком, подписью                    |
| `<Outro>`          | Финальный блок                                                      |
| `<FakeSplat>`      | Заглушка тяжёлого виджета (логирует MOUNT/UNMOUNT в консоль)        |

Добавлять свои — пиши `src/components/Foo.tsx`, импортируй в
`mdx-components.tsx`, выставляй в карту.

---

## Как обернуть реальный тяжёлый виджет (Datum SDK и т.п.)

Замени `FakeSplat` на свою обёртку. Контракт простой:

```tsx
// src/components/DatumScene.tsx
import { useEffect, useRef } from 'react';

export default function DatumScene({ src }: { src: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const viewer = new DatumViewer({ container: host, src });
    return () => viewer.dispose();   // <-- ключевая строка
  }, [src]);

  return <div ref={hostRef} className="absolute inset-0" />;
}
```

И в MDX:

```mdx
<HeavyBlock className="w-full h-screen">
  <DatumScene src="/assets/bull.splat" />
</HeavyBlock>
```

Всё. `HeavyBlock` гарантирует, что `DatumScene` смонтируется только когда
пользователь подъедет, и `useEffect`'s cleanup честно вызовет `dispose()`
когда он уедет.

Если виджет должен реагировать на скролл (камера движется по сцене) —
вытаскивай прогресс через `useStageProgress()` и пробрасывай в SDK:

```tsx
const progress = useStageProgress();
useMotionValueEvent(progress, 'change', (p) => viewer.setCameraT(p));
```

---

## Структура проекта

```
engine/
├── index.html
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx
    ├── App.tsx               ← подключает лонгрид
    ├── index.css             ← Tailwind directives
    ├── mdx.d.ts              ← типы для .mdx import
    ├── engine/               ← переиспользуемое ядро
    │   ├── Longread.tsx
    │   ├── Stage.tsx         ← + useStageProgress()
    │   ├── HeavyBlock.tsx
    │   ├── useInViewMount.ts
    │   ├── ProgressRail.tsx
    │   └── index.ts          ← публичный API
    ├── components/           ← контент-блоки общего назначения
    │   ├── ImageCrossfade.tsx
    │   ├── Steps.tsx
    │   ├── Prose.tsx         ← + Break + Outro
    │   └── FakeSplat.tsx
    ├── content/              ← сами лонгриды
    │   ├── charging-bull.mdx
    │   └── mdx-components.tsx
    └── assets/               ← статика на лонгрид
```

Чтобы добавить второй лонгрид — кладёшь `.mdx` в `content/`, ассеты в
`assets/`, и в `App.tsx` показываешь его (роутинг пока не подключён —
если понадобится несколько URL-ов, добавим React Router или Vike).

---

## Чего пока нет (и когда добавить)

- **SSG/SEO** — добавим Vike, когда дойдём до прода
- **Общий R3F-канвас** — нужен только если на странице больше одного
  нативного 3D-блока одновременно. Тогда заводим один `<Canvas>` в корне
  `Longread` и `<View>`-обёртки в местах появления (drei-паттерн)
- **`CrossfadeStack`** — обобщённый `ImageCrossfade` для любых React-нод
  (splat + 3D в одной зоне, видео + картинка, и т.п.)
- **Роутинг** — `App.tsx` сейчас рендерит один MDX. Если лонгридов
  будет несколько с отдельными URL — добавляй React Router

---

## Производительность: что важно

- **Не клади тяжёлое вне `HeavyBlock`** — иначе оно стартует на загрузке
  страницы и всегда висит в памяти
- **`HeavyBlock`'s host должен иметь высоту** — иначе обсервер никогда не
  пересечётся с вьюпортом
- **Внутри Stage используй `useTransform`** (а не `useState` + ре-рендер).
  Motion-values меняют только CSS, без React-цикла
- **Не плоди WebGL-контексты** — браузер держит ≤8 одновременно. Если
  несколько 3D-блоков — общий `<Canvas>` с `<View>`'ами
- **Картинки в `src/assets/`** Vite сам подсчитает хеш и отдаст
  кешируемые URL-ы. Большие — кодируй WebP/AVIF
