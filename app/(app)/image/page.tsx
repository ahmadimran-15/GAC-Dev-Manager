import ImageReader from "@/components/ImageReader";

export const metadata = { title: "Image · GAC Desk" };

// Read a picture: paste it, drop it or pick it, and ask whatever you want about it.
export default function ImagePage() {
  return (
    <div className="fade-in mx-auto w-full max-w-[1100px] px-4 pb-10 pt-6 md:px-6 md:pt-10 xl:px-10">
      <div className="mb-4">
        <h1 className="text-[30px] font-semibold tracking-tight">Image</h1>
        <p className="mt-1 text-[15px] text-[var(--ink-2)]">Paste with Ctrl+V, drop a file or pick one. Ask for the text inside it, or anything else about it.</p>
      </div>
      <ImageReader />
    </div>
  );
}
