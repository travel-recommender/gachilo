/**
 * 리허설처럼 http://<노트북 IP>로 열면 보안 컨텍스트가 아니라 navigator.clipboard가 없다.
 * 그때는 숨긴 textarea를 선택해 execCommand("copy")로 복사한다. 실패하면 false.
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 권한 거부 등은 아래 방식으로 한 번 더 시도한다
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length); // iOS Safari는 select()만으로 선택되지 않는다
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}
