// Shimmering placeholders shaped like each page, shown while data loads.
const S = ({ w, h = 12, className = "" }: { w: number | string; h?: number; className?: string }) => <div className={`skel ${className}`} style={{ width: w, height: h }} />;

export function Loader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex flex-col items-center gap-4">
        <span className="loader-mark grid h-11 w-11 place-items-center rounded-xl bg-[#171717] text-[17px] font-bold text-white">G</span>
        <div className="loader-bar" />
        <span className="text-[12.5px] text-[var(--muted)]">{label}</span>
      </div>
    </div>
  );
}

function CardSkel() {
  return (
    <div className="card p-5">
      <div className="flex gap-3">
        <div className="skel h-[38px] w-[38px] !rounded-full" />
        <div className="flex-1 space-y-2.5">
          <div className="flex justify-between">
            <S w={180} h={13} />
            <S w={50} h={12} />
          </div>
          <S w={140} h={10} />
          <S w="85%" h={14} className="mt-4" />
          <div className="mt-3 space-y-2 rounded-xl bg-[var(--bg)] p-3.5">
            <S w={110} h={10} />
            <S w="95%" h={12} />
            <S w="70%" h={12} />
          </div>
          <div className="flex gap-2 pt-1">
            <S w={88} h={28} />
            <S w={96} h={28} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="mx-auto max-w-[1240px] px-6 pb-20 pt-10">
      <S w={130} h={11} />
      <S w={420} h={30} className="mt-3" />
      <S w={360} h={14} className="mt-3" />
      <div className="mt-8 grid grid-cols-2 divide-x divide-[var(--line)] border-y border-[var(--line)] md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2.5 px-6 py-5 first:pl-0">
            <S w={110} h={10} />
            <S w={60} h={26} />
            <S w={130} h={10} />
          </div>
        ))}
      </div>
      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <S w={130} h={13} className="mb-4" />
          <CardSkel />
          <CardSkel />
        </div>
        <div className="space-y-4">
          <S w={120} h={13} className="mb-4" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skel h-7 w-7 !rounded-full" />
              <div className="flex-1 space-y-1.5">
                <S w="50%" h={11} />
                <S w="80%" h={10} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="space-y-1 px-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3 px-3 py-3">
          <div className="skel h-9 w-9 shrink-0 !rounded-full" />
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="flex justify-between">
              <S w="45%" h={12} />
              <S w={36} h={10} />
            </div>
            <S w="80%" h={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ThreadSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--line)] px-6 py-4">
        <div className="skel h-[38px] w-[38px] !rounded-full" />
        <div className="space-y-2">
          <S w={160} h={13} />
          <S w={110} h={10} />
        </div>
      </div>
      <div className="flex-1 space-y-4 px-6 py-6">
        <S w="55%" h={44} className="!rounded-2xl" />
        <S w="40%" h={36} className="!rounded-2xl" />
        <div className="flex justify-end">
          <S w="45%" h={40} className="!rounded-2xl" />
        </div>
        <S w="60%" h={52} className="!rounded-2xl" />
      </div>
    </div>
  );
}

export function TeamSkeleton() {
  return (
    <>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="card space-y-3 p-4">
            <div className="flex items-center gap-2.5">
              <div className="skel h-[30px] w-[30px] !rounded-full" />
              <div className="flex-1 space-y-1.5">
                <S w="70%" h={12} />
                <S w="45%" h={10} />
              </div>
            </div>
            <S w="85%" h={10} />
          </div>
        ))}
      </div>
      <div className="card mt-10 space-y-4 p-5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-6">
            <div className="flex-1 space-y-1.5">
              <S w="40%" h={12} />
              <S w="25%" h={10} />
            </div>
            <S w={70} h={12} />
            <S w={80} h={18} className="!rounded-full" />
            <S w={60} h={12} />
          </div>
        ))}
      </div>
    </>
  );
}
