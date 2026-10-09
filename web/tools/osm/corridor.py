# Builds the corridor polygon (a buffer around the route along Broadway) for the Overpass query.
import math, json
R = [(40.7033,-74.0170),(40.7047,-74.0140),(40.7075,-74.0113),(40.7105,-74.0090),(40.7127,-74.0060),
     (40.7160,-74.0036),(40.7192,-74.0013),(40.7253,-73.9966),(40.7310,-73.9925),(40.7357,-73.9907),
     (40.7414,-73.9897),(40.7497,-73.9878),(40.7580,-73.9855),(40.7681,-73.9819),(40.7718,-73.9750)]
LAT0, LON0 = 40.7033, -74.0170
KY = 111320.0; KX = 111320.0*math.cos(math.radians(40.74))
pts = [((lon-LON0)*KX, (lat-LAT0)*KY) for lat,lon in R]
BUF = 380.0
left, right = [], []
for i,(x,y) in enumerate(pts):
    a = pts[max(0,i-1)]; b = pts[min(len(pts)-1,i+1)]
    dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx,dy); nx, ny = -dy/L, dx/L
    left.append((x+nx*BUF, y+ny*BUF)); right.append((x-nx*BUF, y-ny*BUF))
# extend ends
def ext(p, q, d):
    dx,dy=p[0]-q[0],p[1]-q[1]; L=math.hypot(dx,dy); return (p[0]+dx/L*d, p[1]+dy/L*d)
left[0]=ext(left[0],left[1],200); right[0]=ext(right[0],right[1],200)
left[-1]=ext(left[-1],left[-2],250); right[-1]=ext(right[-1],right[-2],250)
poly = left + right[::-1]
ll = [(LAT0 + y/KY, LON0 + x/KX) for x,y in poly]
s = " ".join(f"{a:.6f} {b:.6f}" for a,b in ll)
open("corridor.txt","w").write(s)
json.dump({"route":R,"origin":[LAT0,LON0]}, open("route.json","w"))
print(len(ll), "points")
