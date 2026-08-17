import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Inter được khai báo trong tailwind.config.ts nhưng chưa bao giờ được nạp, nên cả
// app vẫn đang render bằng system-ui. Tự host thay vì gọi Google Fonts: không thêm
// request tới bên thứ ba và không rò referrer của người dùng.
import "@fontsource-variable/inter";

import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
