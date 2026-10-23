import { ratio, score } from "get-contrast";

export default function Page() {
  return (
    <main>
      <h1>get-contrast</h1>
      <p>
        #000 on #fff: {String(ratio("#000", "#fff"))} ({score("#000", "#fff")})
      </p>
    </main>
  );
}
