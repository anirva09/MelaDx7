import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";

import { ImageUploader, type ImageMeta, type ImageUploaderHandle } from "@/components/ImageUploader";
import { mockImageLoading } from "@/test/utils";

function Harness({
  onChange,
  variant = "pointer",
}: {
  onChange?: (f: File | null) => void;
  variant?: "pointer" | "touch";
}) {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const handle = useRef<ImageUploaderHandle>(null);
  return (
    <>
      <ImageUploader
        ref={handle}
        file={file}
        onFileChange={(f) => {
          setFile(f);
          onChange?.(f);
        }}
        onMeta={setMeta}
        maxBytes={5000}
        variant={variant}
      />
      {meta && <p>{`${meta.width} × ${meta.height} px`}</p>}
      <button type="button" onClick={() => handle.current?.clear()}>
        Remove
      </button>
    </>
  );
}

const jpeg = (size = 1000, name = "lesion.jpg") =>
  new File([new Uint8Array(size)], name, { type: "image/jpeg" });

describe("ImageUploader", () => {
  beforeEach(() => mockImageLoading(600, 450));

  it("shows a preview with dimensions for a valid image and can remove it", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.upload(screen.getByTestId("file-input"), jpeg());
    expect(await screen.findByAltText("Preview of lesion.jpg")).toBeInTheDocument();
    expect(screen.getByText(/600 × 450 px/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Remove/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: /Choose a dermoscopic image/ })).toBeInTheDocument();
  });

  it("offers camera, photos and files on touch devices", () => {
    render(<Harness variant="touch" />);
    for (const name of ["Take a photo", "Choose from photos", "Browse files"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /Add a dermoscopic image/ })).toBeInTheDocument();
  });

  it("rejects unsupported types and oversized files with a message", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.upload(
      screen.getByTestId("file-input"),
      new File(["x"], "notes.pdf", { type: "application/pdf" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Unsupported file type/);
    await user.upload(screen.getByTestId("file-input"), jpeg(10_000));
    expect(screen.getByRole("alert")).toHaveTextContent(/limit/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects images smaller than the minimum size", async () => {
    mockImageLoading(40, 40);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.upload(screen.getByTestId("file-input"), jpeg());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/at least 64 px/));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
