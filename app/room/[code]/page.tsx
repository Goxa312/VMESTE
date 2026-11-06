import Room from "@/components/room";
export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) { const { code } = await params; return <Room key={code} code={code}/>; }
