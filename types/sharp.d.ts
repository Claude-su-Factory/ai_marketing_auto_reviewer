declare module "sharp" {
  interface Metadata {
    width?: number;
    height?: number;
    format?: string;
    size?: number;
  }
  interface Sharp {
    metadata(): Promise<Metadata>;
  }
  function sharp(input?: string | Buffer): Sharp;
  export default sharp;
}
