"use client";
import {useEffect, useRef, useState, type RefObject} from "react";
import {playbackUrl,type RoomState} from "@/lib/shared";
import {mediaFormat} from "@/lib/video-source";
import {useLanguage} from "./language";
import {Modal} from "./ui";

export function PlaybackDetails({panel,room,connected,host,onClose}:{
  panel:RefObject<HTMLDivElement|null>; room:RoomState; connected:boolean; host:boolean; onClose:()=>void;
}) {
  const {t}=useLanguage();
  const [copied,setCopied]=useState(false), [manual,setManual]=useState("");
  const [presented,setPresented]=useState<number>();
  const [,refresh]=useState(0), selection=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{
    let pending: {video:HTMLVideoElement; id:number} | undefined;
    const sample=()=>{
      if(pending) pending.video.cancelVideoFrameCallback(pending.id);
      const video=panel.current?.querySelector("video");
      if(video?.requestVideoFrameCallback) pending={video,id:video.requestVideoFrameCallback((_,info)=>{pending=undefined;setPresented(info.presentedFrames);})};
      refresh(n=>n+1);
    };
    sample();const timer=setInterval(sample,1500);
    return ()=>{clearInterval(timer);if(pending)pending.video.cancelVideoFrameCallback(pending.id);};
  },[panel]);
  useEffect(()=>{if(manual){selection.current?.focus();selection.current?.select();}},[manual]);
  const root=panel.current, video=root?.querySelector<HTMLVideoElement>("video"), stage=root?.querySelector<HTMLElement>(".live-stage");
  let transport = room.sourceMode==="upload" ? t("Загруженный файл") :
    (room.nativeSource?.format ?? mediaFormat(playbackUrl(room)))==="hls" ? "HLS" : t("Видеофайл");
  if(stage) {
    if(host) transport=t(room.sourceMode==="local" ? "Показ файла" : "Показ вкладки");
    else if(video?.srcObject) transport="WebRTC";
    else if(video?.getAttribute("src")?.startsWith("blob:")) transport=t("Сервер комнаты");
    else transport=t(room.shareId ? "Подключаемся к показу…" : "Ждём фильм от ведущего");
  }
  const decoded=video?.getVideoPlaybackQuality?.().totalVideoFrames || presented;
  const rows=[
    [t("Связь с комнатой"),t(connected?"Есть связь":"Восстанавливаем связь")],
    [t("Способ просмотра"),transport],
    [t("Видео"),video?.videoWidth ? video.videoWidth+" × "+video.videoHeight : t("Первого кадра пока нет")],
  ];
  if(typeof decoded==="number")rows.push([t("Кадры"),String(decoded)]);
  if(video) rows.push([t("Состояние плеера"),t(video.error ? "Ошибка воспроизведения" : stage?.dataset.waitingFrame ? "Ждём следующий кадр от ведущего…" : video.ended ? "Просмотрено" : video.readyState<2 ? "Загрузка видео" : video.paused ? "На паузе" : "Воспроизводится")]);
  if(video?.error) rows.push([t("Ошибка браузера"),"MEDIA_ERR "+video.error.code]);
  const http = root?.querySelector(".player-error")?.textContent?.match(/HTTP (\d{3})/)?.[1] || stage?.dataset.lastHttp;
  if(http) rows.push([t("Последняя ошибка запроса"),"HTTP "+http]);
  async function copy() {
    const text=rows.map(([name,value])=>name+" · "+value).join("\n");
    try {await navigator.clipboard.writeText(text);setCopied(true);}
    catch {setManual(text);}
  }
  return <Modal title={t("Сведения о воспроизведении")} onClose={onClose}>
    <dl className="playback-details">{rows.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    <button className="button outline" onClick={()=>void copy()}>{t(copied?"Скопировано":"Скопировать сведения")}</button>
    {manual && <textarea ref={selection} className="playback-report" aria-label={t("Сведения о воспроизведении")} rows={rows.length} readOnly value={manual}/>}
  </Modal>;
}
