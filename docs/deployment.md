# SecondChance containers and deployment

The configuration follows the capstone lab's Kubernetes MongoDB/backend and
Code Engine Express frontend topology. Backend listens on 3060, sentiment on
3000, and `secondchancewebsite` on 9000. Node 22 is shared by CI and the images
to use a supported LTS line; the lab's sample Node 14/18 versions are EOL. See the [Node.js release table](https://nodejs.org/en/about/previous-releases).

## Build contexts

Run these commands from the repository root after dependencies and lockfiles
have been installed/committed. `SN_ICR_NAMESPACE` is supplied by the lab.

```sh
docker build -t us.icr.io/${SN_ICR_NAMESPACE}/secondchanceapp secondChance-backend
docker build -t us.icr.io/${SN_ICR_NAMESPACE}/secondchance-sentiment sentiment
```

Configure `secondChance-frontend/.env` with the real browser-reachable
`REACT_APP_BACKEND_URL`, then build the website:

```sh
npm --prefix secondchancewebsite ci
npm --prefix secondChance-frontend ci
npm --prefix secondChance-frontend run build
docker build -t us.icr.io/${SN_ICR_NAMESPACE}/secondchancewebsite secondchancewebsite
```

The frontend's lab `postbuild` script copies the React build into
`secondchancewebsite/build`. The website image requires that generated folder.
Its Express server also handles `/app/*` so refreshing a client-side route works.
Changing the backend URL requires rebuilding the frontend and website image.

All three Docker contexts exclude local `.env`, `.npmrc`, dependency directories,
and logs, including nested copies. Images run as the unprivileged Node user.
The backend owns its copied `public/images` directory for uploaded files.

## Kubernetes configuration

`deploymongo.yml` uses the lab's MongoDB 6 deployment with a ClusterIP Service;
the database is reachable inside the cluster. MongoDB uses `emptyDir`,
so its contents are temporary and need importing again if the MongoDB Pod is replaced.

Before applying the backend manifest:

- Replace `REPLACE_WITH_NAMESPACE` in its image name.
- Provide the image-pull secret named `icr` in the target namespace.
- Create a Kubernetes Secret named `secondchance-secrets` with key `JWT_SECRET`,
  using a strong generated value supplied outside the repository.

`secondChance-backend/deployment.yml` injects the JWT key with `secretKeyRef`,
and configures `MONGO_URL=mongodb://mongodb-service:27017`, database
`secondChance`, and collection `secondChanceItems`. It creates one backend
replica because uploads use the Pod's local filesystem. The
`secondchance-app-service` Service is ClusterIP; use the lab's port-forwarding
instructions to access the API.

The frontend Code Engine command from the lab is:

```sh
ibmcloud ce application create --name secondchancewebsite \
  --image us.icr.io/${SN_ICR_NAMESPACE}/secondchancewebsite \
  --registry-secret icr-secret --port 9000
```

Build/push the images and check actual deployments before capturing evidence.
These commands and files do not represent a successful deployment log.

## CI

The workflow runs on pushes to `main`, `master`, and `codex/**`, and pull requests
to `main`/`master`. It applies the starter's ESLint Standard configuration, runs
the backend Mocha, real application HTTP smoke, sentiment Node and React navigation
test suites, and builds the actual React
frontend. MongoDB 6 exists only for that job, using database `secondChance_ci`;
the workflow generates a separate ephemeral JWT signing key.
