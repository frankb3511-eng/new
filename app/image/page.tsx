import ImageLab from "./ImageLab";

export default function ImagePage() {
  return (
    <>
      <h1>Image lab — local analysis</h1>
      <p className="subtitle">
        100% local: perceptual hashing (aHash/dHash) for cross-profile avatar comparison and EXIF/XMP/ICC/GPS
        metadata extraction. Your image is decoded in-process and <strong>never sent to a third party</strong>.
      </p>
      <ImageLab />
    </>
  );
}
